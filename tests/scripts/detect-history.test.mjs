import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { git } from '../../plugin/skills/agent-ready/scripts/lib/git.mjs';
import { parseStamp } from '../../plugin/skills/agent-ready/scripts/lib/stamp.mjs';
import { generateLegacy } from '../fixtures/generate-legacy.mjs';
import { commitAll, copyFixture, makeRepo, runDetect } from '../helpers.mjs';

const stampLine = (commit) => `<!-- agent-ready: v=0.1.0 commit=${commit} -->`;
const WS = "packages:\n  - 'packages/*'\n";

test('parseStamp accepts only the exact last-line form', () => {
  assert.deepEqual(parseStamp('# P\n\n<!-- agent-ready: v=0.1.0 commit=abc123 -->\n\n'),
    { version: '0.1.0', commit: 'abc123' });
  assert.deepEqual(parseStamp('x\r\n<!-- agent-ready: v=1.2.3 commit=none -->\r\n'),
    { version: '1.2.3', commit: 'none' });
  assert.equal(parseStamp('<!-- agent-ready: v=0.1.0 commit=abc123 -->\ntrailing text\n'), null);
  assert.equal(parseStamp('<!-- agent-ready: v=0.1.0 commit=abc123 --> x'), null);
  assert.equal(parseStamp('<!-- agent-ready: v=0.1.0 -->'), null);
  assert.equal(parseStamp(''), null);
  assert.equal(parseStamp(null), null);
});

test('stamp is read and changes are listed', async () => {
  const dir = await makeRepo({ 'a.js': '' }, { git: true });
  const sha = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
  writeFileSync(join(dir, 'AGENTS.md'), `# P\n\n<!-- agent-ready: v=0.1.0 commit=${sha} -->\n`);
  writeFileSync(join(dir, 'b.js'), '');
  commitAll(dir, 'second');
  const s = runDetect(dir).json.scopes[0];
  assert.deepEqual(s.stamp, { version: '0.1.0', commit: sha });
  assert.equal(s.changedSinceStamp.files, 2);
  assert.ok(s.changedSinceStamp.top.includes('b.js'));
});

test('unknown stamp commit warns', async () => {
  const dir = await makeRepo({ 'a.js': '', 'AGENTS.md': `# P\n\n${stampLine('deadbeef')}\n` }, { git: true });
  const { json } = runDetect(dir);
  assert.equal(json.scopes[0].stamp.commit, 'deadbeef');
  assert.equal(json.scopes[0].changedSinceStamp, null);
  assert.ok(json.warnings.some((w) => /stamp/.test(w)));
});

test('commit=none', async () => {
  const dir = await makeRepo({ 'a.js': '', 'AGENTS.md': `# P\n\n${stampLine('none')}\n` }, { git: true });
  const { json } = runDetect(dir);
  assert.equal(json.scopes[0].stamp.commit, 'none');
  assert.equal(json.scopes[0].changedSinceStamp, null);
  assert.ok(!json.warnings.some((w) => /stamp/.test(w)));
});

test('malformed or misplaced stamp is ignored', async () => {
  const cases = [
    `${stampLine('abc123')}\n\nmore text\n`,
    '# P\n\n<!-- agent-ready: v=0.1.0 commit=abc123 -- >\n',
    '# P\n\n<!-- agent-ready: v=0.1.0 -->\n',
  ];
  for (const text of cases) {
    const dir = await makeRepo({ 'a.js': '', 'AGENTS.md': text }, { git: true });
    const { json } = runDetect(dir);
    assert.equal(json.scopes[0].stamp, null);
    assert.equal(json.scopes[0].changedSinceStamp, null);
  }
});

test('missing stamp gives null fields', async () => {
  const s = runDetect(await makeRepo({ 'a.js': '' }, { git: true })).json.scopes[0];
  assert.equal(s.stamp, null);
  assert.equal(s.changedSinceStamp, null);
});

test('changedSinceStamp top caps at 5, or 50 with --scope', async () => {
  const dir = await makeRepo({ 'a.js': '' }, { git: true });
  const sha = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
  writeFileSync(join(dir, 'AGENTS.md'), `# P\n\n${stampLine(sha)}\n`);
  for (let i = 0; i < 60; i++) writeFileSync(join(dir, `n${String(i).padStart(2, '0')}.js`), '');
  commitAll(dir, 'many');
  const s = runDetect(dir).json.scopes[0];
  assert.equal(s.changedSinceStamp.files, 61);
  assert.equal(s.changedSinceStamp.top.length, 5);
  const detailed = runDetect(dir, ['--scope', '.']).json.scopes[0];
  assert.equal(detailed.changedSinceStamp.top.length, 50);
});

test('hotDirs rank by recent commits', async () => {
  const dir = await makeRepo({ 'src/billing/a.js': '1', 'src/core/b.js': '1' }, { git: true });
  for (let i = 2; i <= 3; i++) {
    writeFileSync(join(dir, 'src/billing/a.js'), String(i));
    commitAll(dir, `billing ${i}`);
  }
  for (let i = 2; i <= 6; i++) {
    writeFileSync(join(dir, 'src/core/b.js'), String(i));
    commitAll(dir, `old core ${i}`, { daysAgo: 200 });
  }
  const s = runDetect(dir).json.scopes[0];
  assert.deepEqual(s.hotDirs, ['src/billing', 'src/core']);
});

test('hotDirs use two path segments and cap at five', async () => {
  const files = {};
  for (let i = 0; i < 7; i++) files[`src/d${i}/deep/x/f.js`] = '';
  files['root.js'] = '';
  const s = runDetect(await makeRepo(files)).json.scopes[0];
  assert.equal(s.hotDirs.length, 5);
  assert.ok(s.hotDirs.every((d) => /^src\/d\d$/.test(d)));
});

test('hotDirs fall back to file count', async () => {
  const dir = await makeRepo({
    'src/aasmall/1.js': '', 'src/zzbig/1.js': '', 'src/zzbig/2.js': '', 'src/zzbig/3.js': '',
  });
  assert.deepEqual(runDetect(dir).json.scopes[0].hotDirs, ['src/zzbig', 'src/aasmall']);
});

test('strategy threshold', async () => {
  const many = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}.txt`, '']));
  assert.equal(runDetect(await makeRepo(many(999), { git: true })).json.recommendedStrategy, 'inline');
  assert.equal(runDetect(await makeRepo(many(1000), { git: true })).json.recommendedStrategy, 'parallel');
  const ws = (n) => ({
    'pnpm-workspace.yaml': WS,
    ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`packages/p${i}/package.json`, '{}'])),
  });
  assert.equal(runDetect(await makeRepo(ws(2))).json.recommendedStrategy, 'parallel');
  assert.equal(runDetect(await makeRepo(ws(1))).json.recommendedStrategy, 'inline');
});

test('200 members stay within limits', async () => {
  const files = { 'pnpm-workspace.yaml': WS };
  for (let i = 0; i < 200; i++) {
    files[`packages/p${String(i).padStart(3, '0')}/package.json`] = '{"scripts":{"test":"x"}}';
  }
  const r = runDetect(await makeRepo(files));
  assert.equal(r.json.scopes.length, 25);
  assert.equal(r.json.scopes[0].path, '.');
  assert.equal(r.json.workspaces.truncated, true);
  assert.equal(r.json.workspaces.total, 200);
  assert.ok(Buffer.byteLength(r.stdout) < 40000);
});

test('exactly 24 members are not truncated', async () => {
  const files = { 'pnpm-workspace.yaml': WS };
  for (let i = 0; i < 24; i++) files[`packages/p${String(i).padStart(2, '0')}/package.json`] = '{}';
  const { json } = runDetect(await makeRepo(files));
  assert.equal(json.scopes.length, 25);
  assert.equal(json.workspaces.truncated, false);
});

test('long CI commands are truncated', async () => {
  const dir = await makeRepo({
    '.github/workflows/ci.yml': `jobs:\n  t:\n    steps:\n      - run: echo ${'x'.repeat(500)}\n`,
  });
  const ci = runDetect(dir).json.scopes[0].commandCandidates.find((c) => c.name === 'ci');
  assert.equal(ci.command.length, 200);
});

test('active members come first, and the cap keeps the most active', async () => {
  const files = { 'pnpm-workspace.yaml': WS };
  for (let i = 0; i < 30; i++) files[`packages/p${String(i).padStart(2, '0')}/package.json`] = '{}';
  const dir = await makeRepo(files, { git: true });
  writeFileSync(join(dir, 'packages/p29/package.json'), '{"a":1}');
  commitAll(dir, 'touch p29');
  writeFileSync(join(dir, 'packages/p27/package.json'), '{"a":1}');
  commitAll(dir, 'touch p27');
  const paths = runDetect(dir).json.scopes.map((s) => s.path);
  assert.deepEqual(paths.slice(0, 4), ['.', 'packages/p27', 'packages/p29', 'packages/p00']);
  assert.equal(paths.length, 25);
});

test('--scope returns one scope in detail', async () => {
  const dir = await copyFixture('monorepo-pnpm');
  const r = runDetect(dir, ['--scope', 'packages\\web']);
  assert.equal(r.code, 0);
  assert.equal(r.json.scopes.length, 1);
  assert.equal(r.json.scopes[0].path, 'packages/web');
  assert.ok(Array.isArray(r.json.scopes[0].hotDirs));
});

test('--scope outside root or missing exits 2', async () => {
  const dir = await copyFixture('monorepo-pnpm');
  for (const bad of ['..', '../elsewhere', 'packages/nope']) {
    const r = runDetect(dir, ['--scope', bad]);
    assert.equal(r.code, 2, bad);
    assert.equal(r.stdout, '');
  }
  assert.equal(runDetect(dir, ['--scope']).code, 2);
});

test('generated legacy repo', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-ready-legacy-'));
  await generateLegacy(dir, { files: 1500 });
  const start = Date.now();
  const { json, code } = runDetect(dir);
  assert.equal(code, 0);
  assert.ok(Date.now() - start < 15_000, `detect took ${Date.now() - start} ms`);
  assert.equal(json.recommendedStrategy, 'parallel');
  assert.equal(json.scopes[0].hotDirs[0], 'src/billing');
});

test('root inside a larger repository reports root-relative history', async () => {
  const dir = await makeRepo({
    'sub/src/billing/a.js': '1', 'sub/src/core/b.js': '1', 'outside/o.js': '1',
  }, { git: true });
  const sha = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
  writeFileSync(join(dir, 'sub/AGENTS.md'), `# P\n\n${stampLine(sha)}\n`);
  writeFileSync(join(dir, 'sub/src/billing/a.js'), '2');
  writeFileSync(join(dir, 'sub/src/billing/c.js'), '');
  writeFileSync(join(dir, 'outside/o.js'), '2');
  commitAll(dir, 'later');
  writeFileSync(join(dir, 'sub/src/billing/a.js'), '3');
  writeFileSync(join(dir, 'outside/o.js'), '3');
  commitAll(dir, 'later again');
  const s = runDetect(join(dir, 'sub')).json.scopes[0];
  assert.deepEqual(s.changedSinceStamp.top.sort(), ['AGENTS.md', 'src/billing/a.js', 'src/billing/c.js']);
  assert.equal(s.changedSinceStamp.files, 3);
  assert.deepEqual(s.hotDirs, ['src/billing', 'src/core']);
});
