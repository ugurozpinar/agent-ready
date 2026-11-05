import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeRepo, runValidate } from '../helpers.mjs';

const STAMP = '<!-- agent-ready: v=0.1.0 commit=abc123 -->';
const agents = (body) => ({ 'AGENTS.md': `# P\n\n${body}\n\n${STAMP}\n`, 'CLAUDE.md': '@AGENTS.md\n' });
const pkg = (scripts) => ({ 'package.json': JSON.stringify({ scripts }) });
const ids = (r) => r.json.errors.map((e) => e.check);
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
const check = async (files, opts) => runValidate(await makeRepo(files, opts));

const SCRIPTS = { test: 'x', lint: 'x', build: 'x', dev: 'x' };
const MAKEFILE = 'build:\n\techo build\n\nVAR := 1\n';
const JUSTFILE = 'build:\n  echo build\n';

for (const cmd of ['npm test', 'npm run lint -- --fix', 'pnpm build', 'yarn dev']) {
  test(`known command: ${cmd}`, async () => {
    const r = await check({ ...agents(`Run \`${cmd}\`.`), ...pkg(SCRIPTS) });
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.errors, []);
  });
}

for (const cmd of ['pnpm --filter web nope', 'cd x && npm run nope', 'npm ci', 'pnpm install', 'cargo test', 'pytest']) {
  test(`unverifiable command ignored: ${cmd}`, async () => {
    const r = await check({ ...agents(`Run \`${cmd}\`.`), ...pkg(SCRIPTS) });
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.errors, []);
  });
}

for (const cmd of ['npm run nope', 'pnpm nope', 'make nope', 'just nope']) {
  test(`unknown command: ${cmd}`, async () => {
    const r = await check({
      ...agents(`Run \`${cmd}\`.`),
      ...pkg(SCRIPTS),
      Makefile: MAKEFILE,
      justfile: JUSTFILE,
    });
    assert.equal(r.code, 1);
    assert.deepEqual(ids(r), ['unknown-command']);
  });
}

test('known make and just targets', async () => {
  const r = await check({ ...agents('Run `make build` or `just build`.'), Makefile: MAKEFILE, justfile: JUSTFILE });
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.errors, []);
});

test('just directives are not recipes', async () => {
  for (const word of ['export', 'set', 'import', 'mod', 'alias']) {
    const justfile = `${word} x := "a:b"\nbuild:\n  echo build\n`;
    const r = await check({ ...agents(`Run \`just ${word}\`.`), justfile });
    assert.deepEqual(ids(r), ['unknown-command'], word);
  }
});

test('make without a Makefile', async () => {
  const r = await check(agents('Run `make build`.'));
  assert.deepEqual(ids(r), ['unknown-command']);
});

test('npm without a package.json', async () => {
  const r = await check(agents('Run `npm test`.'));
  assert.deepEqual(ids(r), ['unknown-command']);
});

test('commands in fenced blocks', async () => {
  const r = await check({ ...agents('```bash\nnpm run nope\n```'), ...pkg(SCRIPTS) });
  assert.deepEqual(ids(r), ['unknown-command']);
});

test('root accepts a member script', async () => {
  const r = await check({
    ...agents('Run `npm run dev`. See `packages/*/AGENTS.md`.'),
    'package.json': '{"private":true,"workspaces":["packages/*"]}',
    'packages/web/package.json': JSON.stringify({ name: 'web', scripts: { dev: 'x' } }),
    'packages/web/AGENTS.md': `# Web\n\n${STAMP}\n`,
    'packages/web/CLAUDE.md': '@AGENTS.md\n',
  });
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.errors, []);
});

test('broken path', async () => {
  const missing = await check(agents('See `docs/ai/x.md`.'));
  assert.deepEqual(ids(missing), ['broken-path']);
  const present = await check({ ...agents('See `docs/ai/x.md`.'), 'docs/ai/x.md': '# X\n' });
  assert.equal(present.code, 0);
  const link = await check(agents('See [the doc](docs/ai/x.md).'));
  assert.deepEqual(ids(link), ['broken-path']);
});

test('ignored references', async () => {
  const body = [
    'See `https://x.dev/a.md`, [anchor](#top), [site](https://x.dev/page) and `packages/*/AGENTS.md`.',
    '',
    '```',
    '`missing.md`',
    '```',
  ].join('\n');
  const r = await check(agents(body));
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.errors, []);
});

test('package path resolves locally', async () => {
  const r = await check({
    ...agents('See `packages/*/AGENTS.md`.'),
    'package.json': '{"private":true,"workspaces":["packages/*"]}',
    'packages/web/package.json': '{"name":"web"}',
    'packages/web/AGENTS.md': `# Web\n\nSee \`../../docs/ai/x.md\`.\n\n${STAMP}\n`,
    'packages/web/CLAUDE.md': '@AGENTS.md\n',
    'docs/ai/x.md': '# X\n',
  });
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.errors, []);
});

test('template markers', async () => {
  const marker = await check(agents('Name: {{ar:name}}'));
  assert.deepEqual(ids(marker), ['template-marker']);
  const i18n = await check({
    ...agents('Tone is in `docs/ai/voice-and-tone.md`.'),
    'docs/ai/voice-and-tone.md': 'Status: confirmed\n\nHello {{name}}\n',
  });
  assert.equal(i18n.code, 0);
  assert.deepEqual(i18n.json.errors, []);
});

test('doc status', async () => {
  const none = await check({ ...agents('See `docs/ai/voice-and-tone.md`.'), 'docs/ai/voice-and-tone.md': '# Voice\n' });
  assert.deepEqual(ids(none), ['doc-status']);
  const bad = await check({
    ...agents('See `docs/ai/voice-and-tone.md`.'),
    'docs/ai/voice-and-tone.md': 'Status: final\n',
  });
  assert.deepEqual(ids(bad), ['doc-status']);
});

test('open questions', async () => {
  const draft = await check({
    ...agents('See `docs/ai/personas.md`.'),
    'docs/ai/personas.md': 'Status: draft\n\n# Personas\n',
  });
  assert.deepEqual(ids(draft), ['open-questions']);
  const confirmed = await check({
    ...agents('See `docs/ai/personas.md`.'),
    'docs/ai/personas.md': 'Status: confirmed\n\n## Open questions\n\n- who?\n',
  });
  assert.deepEqual(ids(confirmed), ['open-questions']);
  const ok = await check({
    ...agents('See `docs/ai/personas.md`.'),
    'docs/ai/personas.md': 'Status: draft\n\n## Open questions\n\n- who?\n',
  });
  assert.equal(ok.code, 0);
});

test('other documents need no status', async () => {
  const r = await check({
    ...agents('See `README.md` and `docs/ai/ai-memory.md`.'),
    'README.md': '# Readme\n',
    'docs/ai/ai-memory.md': 'notes\n',
  });
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.errors, []);
});

test('unreferenced doc in docs/ai is checked', async () => {
  const r = await check({ ...agents('Nothing here.'), 'docs/ai/product-overview.md': '# Overview\n' });
  assert.deepEqual(ids(r), ['doc-status']);
});

test('custom folder is checked', async () => {
  const r = await check({ ...agents('See `internal/ai/personas.md`.'), 'internal/ai/personas.md': '# Personas\n' });
  assert.deepEqual(ids(r), ['doc-status']);
  assert.equal(r.json.errors[0].file, 'internal/ai/personas.md');
});

test('git-ignored', async () => {
  const files = {
    ...agents('See `docs/ai/design-system.md`.'),
    'docs/ai/design-system.md': 'Status: confirmed\n',
    '.gitignore': 'docs/\n',
  };
  const inGit = await check(files, { git: true });
  assert.deepEqual(ids(inGit), ['git-ignored']);
  const noGit = await check(files);
  assert.equal(noGit.code, 0);
  assert.deepEqual(noGit.json.errors, []);
});

test('secret', async () => {
  const value = 'AKIAABCDEFGHIJKLMNOP';
  const r = await check({ ...agents('Nothing.'), 'docs/ai/ai-memory.md': `ok\nkey ${value}\n` });
  assert.equal(r.code, 1);
  assert.deepEqual(ids(r), ['secret']);
  assert.equal(r.json.errors[0].file, 'docs/ai/ai-memory.md');
  assert.match(r.json.errors[0].message, /line 2/);
  assert.ok(!r.stdout.includes(value));
});

test('memory budget', async () => {
  const at = await check({ ...agents('Nothing.'), 'docs/ai/ai-memory.md': `${lines(200)}\n` });
  assert.equal(at.code, 0);
  assert.deepEqual(at.json.warnings, []);
  const over = await check({ ...agents('Nothing.'), 'docs/ai/ai-memory.md': `${lines(201)}\n` });
  assert.equal(over.code, 0);
  assert.deepEqual(over.json.warnings.map((w) => w.check), ['memory-budget']);
});

test('sk- inside a word is not a secret', async () => {
  const prose = await check({ ...agents('Nothing.'), 'docs/ai/ai-memory.md': 'We use task-management-and-planning-system here.\n' });
  assert.equal(prose.code, 0);
  assert.deepEqual(prose.json.errors, []);
  const key = await check({ ...agents('Nothing.'), 'docs/ai/ai-memory.md': 'key sk-abcdefghijklmnopqrstuvwx\n' });
  assert.deepEqual(ids(key), ['secret']);
});

test('unfilled marker in a referenced ai-memory.md is an error', async () => {
  const r = await check({
    ...agents('See `docs/ai/ai-memory.md`.'),
    'docs/ai/ai-memory.md': '# AI memory\n\n{{ar:x}}\n',
  });
  assert.deepEqual(ids(r), ['template-marker']);
  assert.equal(r.code, 1);
});
