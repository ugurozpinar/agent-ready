import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { copyFixture, makeRepo, runDetect } from '../helpers.mjs';

const cmd = (scope, name) => scope.commandCandidates.find((c) => c.name === name);
const root = async (files) => runDetect(await makeRepo(files)).json.scopes[0];

test('app-ui fixture', async () => {
  const { json } = runDetect(await copyFixture('app-ui'));
  const s = json.scopes[0];
  assert.deepEqual(s.signals, { ui: true, userText: true, product: true });
  assert.ok(s.stacks.includes('typescript') && s.stacks.includes('react'));
  assert.deepEqual(cmd(s, 'test'), { name: 'test', command: 'npm test', source: 'package.json' });
  assert.equal(cmd(s, 'lint').command, 'npm run lint');
  assert.ok(s.docs.includes('README.md'));
  assert.equal('warnings' in s, false);
});

test('library fixture has no signals', async () => {
  const { json } = runDetect(await copyFixture('library'));
  assert.deepEqual(json.scopes[0].signals, { ui: false, userText: false, product: false });
  assert.ok(json.scopes[0].stacks.includes('typescript'));
});

test('empty fixture has no stacks', async () => {
  const { json } = runDetect(await copyFixture('empty'));
  assert.equal(json.state, 'empty');
  assert.deepEqual(json.scopes[0].stacks, []);
});

test('lock file decides the command', async () => {
  const pkg = '{"scripts":{"test":"x","lint":"y"}}';
  assert.equal(cmd(await root({ 'package.json': pkg, 'pnpm-lock.yaml': '' }), 'test').command, 'pnpm test');
  assert.equal(cmd(await root({ 'package.json': pkg, 'yarn.lock': '' }), 'test').command, 'yarn test');
  assert.equal(cmd(await root({ 'package.json': pkg, 'bun.lock': '' }), 'test').command, 'bun run test');
  assert.equal(cmd(await root({ 'package.json': pkg, 'bun.lockb': '' }), 'test').command, 'bun run test');
  assert.equal(cmd(await root({ 'package.json': pkg }), 'lint').command, 'npm run lint');
});

test('member uses the root lock file', async () => {
  const { json } = runDetect(await copyFixture('monorepo-pnpm'));
  const web = json.scopes.find((s) => s.path === 'packages/web');
  assert.equal(cmd(web, 'test').command, 'pnpm test');
  assert.equal(web.signals.ui, true);
  assert.ok(web.stacks.includes('react'));
});

test('make, just, cargo, go, python', async () => {
  const s = await root({
    Makefile: '.PHONY: build\nCC := gcc\nbuild:\n\techo hi\n',
    justfile: 'set shell := ["sh", "-c"]\nfmt:\n  echo fmt\n',
    'Cargo.toml': '[package]\nname = "x"\n',
    'go.mod': 'module x\n',
    'pyproject.toml': '[tool.pytest.ini_options]\n[tool.ruff]\n',
  });
  assert.deepEqual(cmd(s, 'build'), { name: 'build', command: 'make build', source: 'Makefile' });
  assert.deepEqual(cmd(s, 'fmt'), { name: 'fmt', command: 'just fmt', source: 'justfile' });
  const commands = s.commandCandidates.map((c) => `${c.command}|${c.source}`);
  for (const expected of ['cargo test|Cargo.toml', 'cargo build|Cargo.toml', 'go test ./...|go.mod',
    'go build ./...|go.mod', 'pytest|pyproject.toml', 'ruff check|pyproject.toml']) {
    assert.ok(commands.includes(expected), expected);
  }
  assert.equal(commands.filter((c) => c.startsWith('make ')).length, 1);
  for (const stack of ['rust', 'go', 'python']) assert.ok(s.stacks.includes(stack), stack);
});

test('pytest.ini and the command cap', async () => {
  const s = await root({ 'pytest.ini': '[pytest]\n', 'setup.py': '' });
  assert.ok(s.commandCandidates.some((c) => c.command === 'pytest' && c.source === 'pytest.ini'));
  const makefile = Array.from({ length: 12 }, (_, i) => `target${i}:\n\techo\n`).join('');
  assert.equal((await root({ Makefile: makefile })).commandCandidates.length, 10);
});

test('CI run lines', async () => {
  const s = await root({
    '.github/workflows/ci.yml': [
      'jobs:', '  t:', '    steps:',
      '      - run: npm run check',
      '      - name: multi',
      '        run: |',
      '          npm run ignored',
      '',
    ].join('\n'),
  });
  const ci = s.commandCandidates.find((c) => c.command === 'npm run check');
  assert.equal(ci.source, '.github/workflows/ci.yml');
  assert.equal(s.commandCandidates.some((c) => c.command === 'npm run ignored' || c.command === '|'), false);
});

test('instruction kinds', async () => {
  const bridge = await root({ 'CLAUDE.md': '@AGENTS.md\n', 'a.js': 'x' });
  assert.deepEqual(bridge.instructionFiles, [{ path: 'CLAUDE.md', kind: 'bridge' }]);

  const { json } = runDetect(await copyFixture('existing-claude-md'));
  assert.deepEqual(json.scopes[0].instructionFiles, [{ path: 'CLAUDE.md', kind: 'content' }]);

  const conflict = runDetect(await copyFixture('conflicting-instructions')).json.scopes[0];
  assert.deepEqual(conflict.instructionFiles.map((f) => f.path), ['AGENTS.md', 'CLAUDE.md']);
});

test('symlinked CLAUDE.md is a symlink', async (t) => {
  const dir = await makeRepo({ 'AGENTS.md': 'rules\n', 'a.js': 'x' });
  try {
    await symlink('AGENTS.md', join(dir, 'CLAUDE.md'), 'file');
  } catch (e) {
    if (e.code === 'EPERM') return t.skip('symlinks need privileges on this platform');
    throw e;
  }
  const { json } = runDetect(dir);
  assert.deepEqual(json.scopes[0].instructionFiles.find((f) => f.path === 'CLAUDE.md'),
    { path: 'CLAUDE.md', kind: 'symlink' });
});

test('instruction files are found in .claude/ and in members', async () => {
  const dir = await makeRepo({
    'pnpm-workspace.yaml': 'packages:\n  - "p/*"\n',
    'p/a/package.json': '{}',
    'p/a/AGENTS.md': 'x\n',
    '.claude/CLAUDE.md': '@AGENTS.md\n',
  });
  const { json } = runDetect(dir);
  assert.deepEqual(json.scopes[0].instructionFiles, [{ path: '.claude/CLAUDE.md', kind: 'bridge' }]);
  assert.deepEqual(json.scopes[1].instructionFiles, [{ path: 'p/a/AGENTS.md', kind: 'content' }]);
});

test('gitignored CLAUDE.local.md is found', async () => {
  const s = await root({ '.gitignore': 'CLAUDE.local.md\n', 'CLAUDE.local.md': 'mine\n', 'a.js': 'x' });
  assert.deepEqual(s.instructionFiles, [{ path: 'CLAUDE.local.md', kind: 'content' }]);
});

test('published docs', async () => {
  assert.equal(runDetect(await copyFixture('published-docs')).json.publishedDocsSite, 'docusaurus');
  assert.equal(runDetect(await copyFixture('app-ui')).json.publishedDocsSite, null);
  for (const [file, site] of [['mkdocs.yml', 'mkdocs'], ['docs/.vitepress/config.ts', 'vitepress'],
    ['docs/conf.py', 'sphinx'], ['_config.yml', 'jekyll']]) {
    assert.equal(runDetect(await makeRepo({ [file]: 'x', 'a.js': 'x' })).json.publishedDocsSite, site, site);
  }
});

test('docs list covers adr and caps', async () => {
  const files = { 'README.md': '', 'CONTRIBUTING.md': '', 'ARCHITECTURE.md': '', 'a.js': 'x' };
  for (let i = 0; i < 8; i++) files[`docs/adr/000${i}.md`] = '';
  const s = await root(files);
  assert.equal(s.docs.length, 5);
  assert.deepEqual(s.docs.slice(0, 3), ['README.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md']);
  assert.ok(s.docs[3].startsWith('docs/adr/'));
});

test('.env is never read', async () => {
  const { stdout } = runDetect(await copyFixture('app-ui'));
  assert.equal(stdout.includes('SENTINEL_ENV_VALUE'), false);
});

test('invalid package.json in a scope', async () => {
  const dir = await makeRepo({
    'pnpm-workspace.yaml': 'packages:\n  - "p/*"\n',
    'p/a/package.json': '{oops',
    'p/a/src/App.tsx': 'x',
  });
  const { code, json } = runDetect(dir);
  assert.equal(code, 0);
  assert.ok(json.warnings.some((w) => w.includes('p/a/package.json')));
  const a = json.scopes.find((s) => s.path === 'p/a');
  assert.equal(a.signals.ui, true);
  assert.equal('warnings' in a, false);
  assert.equal(json.warnings.length, new Set(json.warnings).size);
});
