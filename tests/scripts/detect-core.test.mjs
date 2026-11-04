import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { commitAll, envWithoutGit, makeRepo, ROOT, runDetect } from '../helpers.mjs';

const lib = (name) => pathToFileURL(join(ROOT, 'skills/agent-ready/scripts/lib', name)).href;

test('empty folder', async () => {
  const { code, json } = runDetect(await makeRepo({}));
  assert.equal(code, 0);
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.state, 'empty');
  assert.equal(json.recommendedStrategy, 'inline');
  assert.deepEqual(json.git, { isRepo: false, head: null, trackedFiles: 0 });
});

test('README, LICENSE and .gitignore alone are empty', async () => {
  const dir = await makeRepo({ 'README.md': '# x', LICENSE: 'MIT', '.gitignore': 'node_modules\n' });
  assert.equal(runDetect(dir).json.state, 'empty');
});

test('an installed skill is not project code', async () => {
  const dir = await makeRepo({
    '.claude/skills/agent-ready/scripts/detect.mjs': 'x',
    '.agents/skills/agent-ready/SKILL.md': 'x',
    'skills-lock.json': '{}',
    'README.md': '# x',
  });
  const { json } = runDetect(dir);
  assert.equal(json.state, 'empty');
  assert.equal(json.scopes[0].files, 2);
});

test('installed skill stays excluded when tracked by git', async () => {
  const dir = await makeRepo(
    { '.claude/skills/a/detect.mjs': 'x', '.agents/skills/a/SKILL.md': 'x', 'README.md': '# x' },
    { git: true },
  );
  const { json } = runDetect(dir);
  assert.equal(json.state, 'empty');
  assert.equal(json.git.trackedFiles, 1);
});

test('one source file is single', async () => {
  assert.equal(runDetect(await makeRepo({ 'src/a.ts': 'x' })).json.state, 'single');
});

test('git repo reports head and tracked files', async () => {
  const dir = await makeRepo({ 'README.md': '# x', 'src/a.ts': 'x' }, { git: true });
  const sha = commitAll(dir, 'again');
  const { json } = runDetect(dir);
  assert.deepEqual(json.git, { isRepo: true, head: sha, trackedFiles: 2 });
});

test('untracked code counts', async () => {
  const dir = await makeRepo({ 'README.md': '# x' }, { git: true });
  await writeFile(join(dir, 'a.ts'), 'x');
  const { json } = runDetect(dir);
  assert.equal(json.state, 'single');
  assert.equal(json.git.trackedFiles, 1);
});

test('path with spaces and non-ASCII', async () => {
  const dir = await makeRepo({ 'src/çalışma.ts': 'x' }, { git: true, prefix: 'agent ready Uğur-' });
  const { code, json } = runDetect(dir);
  assert.equal(code, 0);
  assert.equal(json.state, 'single');
});

test('non-ASCII names survive git listing', async () => {
  const { listFiles } = await import(lib('files.mjs'));
  const dir = await makeRepo({ 'src/çalışma.ts': 'x' }, { git: true });
  assert.ok(listFiles(dir).files.includes('src/çalışma.ts'));
});

test('CRLF and BOM are removed by readText', async () => {
  const { readText } = await import(lib('files.mjs'));
  const dir = await makeRepo({ 'a.txt': '﻿a\r\nb' });
  assert.equal(readText(join(dir, 'a.txt')), 'a\nb');
  assert.equal(readText(join(dir, 'missing.txt')), null);
});

test('readJson never throws', async () => {
  const { readJson } = await import(lib('files.mjs'));
  const dir = await makeRepo({ 'ok.json': '{"a":1}', 'bad.json': '{' });
  assert.deepEqual(readJson(join(dir, 'ok.json')), { value: { a: 1 }, error: null });
  assert.equal(readJson(join(dir, 'bad.json')).value, null);
  assert.ok(readJson(join(dir, 'bad.json')).error);
  assert.ok(readJson(join(dir, 'missing.json')).error);
});

test('matchGlob and isSourceFile', async () => {
  const { matchGlob, isSourceFile } = await import(lib('files.mjs'));
  assert.ok(matchGlob('packages/*', 'packages/a'));
  assert.ok(!matchGlob('packages/*', 'packages/a/b'));
  assert.ok(matchGlob('packages/**', 'packages/a/b'));
  assert.ok(matchGlob('a/**/c', 'a/c'));
  assert.ok(matchGlob('a/**/c', 'a/b/x/c'));
  assert.ok(!matchGlob('a.b', 'axb'));
  assert.ok(!isSourceFile('docs/x.ts'));
  assert.ok(!isSourceFile('.github/workflows/ci.yml'));
  assert.ok(!isSourceFile('LICENSE-MIT'));
  assert.ok(!isSourceFile('Notice'));
  assert.ok(!isSourceFile('a/b/.editorconfig'));
  assert.ok(isSourceFile('src/docs/a.ts'));
});

test('git not on PATH', async () => {
  const dir = await makeRepo({ 'src/a.ts': 'x' });
  const { code, json } = runDetect(dir, [], { env: envWithoutGit() });
  assert.equal(code, 0);
  assert.equal(json.git.isRepo, false);
  assert.equal(json.state, 'single');
});

test('broken .git folder', async () => {
  const dir = await makeRepo({ 'src/a.ts': 'x' });
  await mkdir(join(dir, '.git'));
  const { code, json } = runDetect(dir);
  assert.equal(code, 0);
  assert.equal(json.git.isRepo, false);
  assert.equal(json.state, 'single');
  assert.ok(json.warnings.some((w) => /git/.test(w)));
});

test('root inside a repository', async () => {
  const dir = await makeRepo({ 'top.ts': 'x', 'sub/a.ts': 'x', 'sub/README.md': '#' }, { git: true });
  const { json } = runDetect(join(dir, 'sub'));
  assert.equal(json.git.isRepo, true);
  assert.equal(json.git.trackedFiles, 2);
  assert.equal(json.scopes[0].files, 2);
  const { listFiles } = await import(lib('files.mjs'));
  assert.deepEqual(listFiles(join(dir, 'sub')).files, ['README.md', 'a.ts']);
});

test('walk skips node_modules', async () => {
  const { json } = runDetect(await makeRepo({ 'node_modules/x/a.js': 'x' }));
  assert.equal(json.state, 'empty');
});

test('walk survives a junction cycle', { timeout: 15_000 }, async (t) => {
  const dir = await makeRepo({ 'src/a.ts': 'x' });
  try {
    await symlink(dir, join(dir, 'loop'), 'junction');
  } catch (e) {
    if (e.code === 'EPERM') return t.skip('cannot create links');
    throw e;
  }
  const { code, json } = runDetect(dir);
  assert.equal(code, 0);
  assert.equal(json.scopes[0].files, 1);
});

test('usage errors exit 2', async () => {
  const dir = await makeRepo({});
  const none = spawnSync(process.execPath, [join(ROOT, 'skills/agent-ready/scripts/detect.mjs')], { cwd: dir });
  assert.equal(none.status, 2);
  const missing = runDetect(join(dir, 'nope'), [], { cwd: dir });
  assert.equal(missing.code, 2);
  const flag = runDetect(dir, ['--bogus']);
  assert.equal(flag.code, 2);
});
