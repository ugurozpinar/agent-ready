import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeRepo, runValidate } from '../helpers.mjs';

const STAMP = '<!-- agent-ready: v=0.1.0 commit=abc123 -->';
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
const base = (extra = {}) => ({ 'AGENTS.md': `# P\n\n${STAMP}\n`, 'CLAUDE.md': '@AGENTS.md\n', ...extra });
const ids = (r) => r.json.errors.map((e) => e.check);
const pkg = (body = '# Web') => ({
  'packages/web/package.json': '{"name":"web"}',
  'packages/web/AGENTS.md': `${body}\n\n${STAMP}\n`,
});
const MONO = { 'package.json': '{"private":true,"workspaces":["packages/*"]}' };
const COVERED = '# P\n\nSee `packages/*/AGENTS.md`.\n\n' + STAMP + '\n';
/** Text of exactly `bytes` bytes in a few long lines, ending with the stamp. */
const sized = (bytes) => {
  const tail = `\n${STAMP}\n`;
  const filler = bytes - tail.length;
  return 'x'.repeat(filler) + tail;
};

test('valid root passes', async () => {
  const r = runValidate(await makeRepo(base()));
  assert.equal(r.code, 0);
  assert.equal(r.json.schemaVersion, 1);
  assert.deepEqual(r.json.errors, []);
  assert.deepEqual(r.json.warnings, []);
});

test('missing AGENTS.md', async () => {
  const r = runValidate(await makeRepo({ 'CLAUDE.md': '@AGENTS.md\n' }));
  assert.equal(r.code, 1);
  assert.deepEqual(ids(r), ['agents-missing']);
  assert.equal(r.json.errors[0].file, 'AGENTS.md');
});

test('root budget', async () => {
  const ok = runValidate(await makeRepo(base({ 'AGENTS.md': `${lines(119)}\n${STAMP}\n` })));
  assert.equal(ok.code, 0);
  const over = runValidate(await makeRepo(base({ 'AGENTS.md': `${lines(120)}\n${STAMP}\n` })));
  assert.equal(over.code, 1);
  assert.deepEqual(ids(over), ['agents-budget']);
});

test('package budget', async () => {
  const mk = (n) => makeRepo({ ...MONO, ...base({ 'AGENTS.md': COVERED }), ...pkg(lines(n - 2)) });
  assert.equal(runValidate(await mk(60)).code, 0);
  const over = runValidate(await mk(61));
  assert.deepEqual(ids(over), ['agents-budget']);
  assert.equal(over.json.errors[0].file, 'packages/web/AGENTS.md');
});

test('chain budget', async () => {
  const KiB = 1024;
  const mk = (pkgBytes) =>
    makeRepo({ ...MONO, ...base({ 'AGENTS.md': sized(20 * KiB) }), 'packages/web/package.json': '{"name":"web"}',
      'packages/web/AGENTS.md': sized(pkgBytes) });
  // root is not covered by reference, so only the budget ids matter here
  const withoutCoverage = (r) => ids(r).filter((c) => c !== 'package-coverage');
  assert.deepEqual(withoutCoverage(runValidate(await mk(12 * KiB))), []);
  const over = runValidate(await mk(13 * KiB));
  assert.deepEqual(withoutCoverage(over), ['chain-budget']);
});

test('stamp', async () => {
  const bad = async (text) => ids(runValidate(await makeRepo(base({ 'AGENTS.md': text }))));
  assert.deepEqual(await bad('# P\n'), ['stamp']);
  assert.deepEqual(await bad('# P\n\n<!-- agent-ready: v=0.1.0 -->\n'), ['stamp']);
  assert.deepEqual(await bad(`# P\n${STAMP}\nmore\n`), ['stamp']);
  const none = runValidate(await makeRepo(base({ 'AGENTS.md': '# P\n\n<!-- agent-ready: v=0.1.0 commit=none -->\n' })));
  assert.equal(none.code, 0);
});

test('claude bridge', async () => {
  const missing = runValidate(await makeRepo({ 'AGENTS.md': `# P\n\n${STAMP}\n` }));
  assert.deepEqual(ids(missing), ['claude-bridge']);
  const noImport = runValidate(await makeRepo(base({ 'CLAUDE.md': '# Claude\nread agents\n' })));
  assert.deepEqual(ids(noImport), ['claude-bridge']);
  const inline = runValidate(await makeRepo(base({ 'CLAUDE.md': '# Claude\n\n@AGENTS.md\n\nExtra notes\n' })));
  assert.equal(inline.code, 0);
  const dotted = runValidate(await makeRepo(base({ 'CLAUDE.md': '@./AGENTS.md\n' })));
  assert.equal(dotted.code, 0);

  const dir = await makeRepo({ 'AGENTS.md': `# P\n\n${STAMP}\n` });
  try {
    await symlink('AGENTS.md', join(dir, 'CLAUDE.md'));
  } catch (e) {
    if (e.code === 'EPERM') return;
    throw e;
  }
  assert.equal(runValidate(dir).code, 0);
});

test('--skip-claude-bridge', async () => {
  const dir = await makeRepo({ 'AGENTS.md': `# P\n\n${STAMP}\n` });
  assert.equal(runValidate(dir, ['--skip-claude-bridge']).code, 0);
});

test('package coverage', async () => {
  const mk = (rootText) => makeRepo({ ...MONO, ...base({ 'AGENTS.md': rootText }), ...pkg() });
  const none = runValidate(await mk(`# P\n\n${STAMP}\n`));
  assert.deepEqual(ids(none), ['package-coverage']);
  assert.equal(none.json.errors[0].file, 'packages/web/AGENTS.md');
  assert.equal(runValidate(await mk(COVERED)).code, 0);
  assert.equal(runValidate(await mk(`# P\n\nUse \`packages/web/AGENTS.md\`.\n\n${STAMP}\n`)).code, 0);
  const prose = runValidate(await mk(`# P\n\nUse packages/web/AGENTS.md.\n\n${STAMP}\n`));
  assert.deepEqual(ids(prose), ['package-coverage']);
});

test('CRLF and BOM', async () => {
  const crlf = (s) => s.replaceAll('\n', '\r\n');
  const ok = runValidate(await makeRepo({
    'AGENTS.md': '﻿' + crlf(`# P\n\n${STAMP}\n`),
    'CLAUDE.md': '﻿' + crlf('@AGENTS.md\n'),
  }));
  assert.equal(ok.code, 0);
  const over = runValidate(await makeRepo(base({ 'AGENTS.md': crlf(`${lines(120)}\n${STAMP}\n`) })));
  assert.deepEqual(ids(over), ['agents-budget']);
});

test('AGENTS.override.md warns', async () => {
  const r = runValidate(await makeRepo(base({ 'AGENTS.override.md': '# local\n' })));
  assert.equal(r.code, 0);
  assert.equal(r.json.warnings[0].check, 'agents-override');
  assert.equal(r.json.warnings[0].file, 'AGENTS.override.md');
});

test('--scope validates one scope', async () => {
  const dir = await makeRepo({
    ...MONO,
    ...base({ 'AGENTS.md': `${lines(130)}\n\`packages/*/AGENTS.md\`\n${STAMP}\n` }),
    ...pkg(lines(61)),
  });
  const all = runValidate(dir);
  assert.deepEqual(ids(all), ['agents-budget', 'agents-budget']);
  const one = runValidate(dir, ['--scope', 'packages/web']);
  assert.deepEqual(one.json.errors.map((e) => e.file), ['packages/web/AGENTS.md']);

  const small = await makeRepo({
    ...MONO, ...base({ 'AGENTS.md': sized(20 * 1024) }), ...pkg(lines(2)),
  });
  const web = await makeRepo({
    ...MONO, ...base({ 'AGENTS.md': sized(32 * 1024) }), 'packages/web/package.json': '{}', 'packages/web/AGENTS.md': sized(1024),
  });
  assert.equal(runValidate(small, ['--scope', 'packages/web']).json.errors.some((e) => e.check === 'chain-budget'), false);
  const chain = runValidate(web, ['--scope', 'packages/web']);
  assert.deepEqual(chain.json.errors.filter((e) => e.check === 'chain-budget').map((e) => e.file), ['packages/web/AGENTS.md']);
});

test('usage errors exit 2', async () => {
  const dir = await makeRepo(base());
  assert.equal(runValidate(dir).code, 0);
  assert.equal(runValidate(join(dir, 'missing'), [], { cwd: dir }).code, 2);
  assert.equal(runValidate(dir, ['--bogus']).code, 2);
  assert.equal(runValidate(dir, ['--scope', '..']).code, 2);
  assert.equal(runValidate(dir, ['--scope']).code, 2);
});
