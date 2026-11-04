import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFixture, makeRepo, runDetect } from '../helpers.mjs';

const cases = [
  ['pnpm', { 'pnpm-workspace.yaml': "packages:\n  - 'packages/*' # apps\n  - \"!packages/skip\"\n",
             'packages/a/package.json': '{}', 'packages/skip/package.json': '{}' }, ['packages/a']],
  ['npm', { 'package.json': '{"workspaces":["apps/*"]}', 'apps/a/package.json': '{}' }, ['apps/a']],
  ['yarn', { 'package.json': '{"workspaces":{"packages":["apps/*"]}}', 'yarn.lock': '',
             'apps/a/package.json': '{}' }, ['apps/a']],
  ['lerna', { 'lerna.json': '{"packages":["libs/*"]}', 'libs/a/package.json': '{}' }, ['libs/a']],
  ['nx', { 'nx.json': '{}', 'apps/a/project.json': '{}', 'libs/b/project.json': '{}' }, ['apps/a', 'libs/b']],
  ['turbo', { 'turbo.json': '{}', 'pnpm-workspace.yaml': 'packages:\n  - "pk/*"\n',
              'pk/a/package.json': '{}' }, ['pk/a']],
  ['cargo', { 'Cargo.toml': '[workspace]\nmembers = [\n  "crates/*", # all\n  "tools/x"\n]\nexclude = ["crates/skip"]\n',
              'crates/a/Cargo.toml': '', 'crates/skip/Cargo.toml': '', 'tools/x/Cargo.toml': '' }, ['crates/a', 'tools/x']],
  ['go', { 'go.work': 'go 1.22\nuse (\n  ./svc/a\n  ./svc/b\n)\nuse ./svc/c\n',
           'svc/a/go.mod': '', 'svc/b/go.mod': '', 'svc/c/go.mod': '' }, ['svc/a', 'svc/b', 'svc/c']],
  ['uv', { 'pyproject.toml': '[tool.uv.workspace]\nmembers = ["py/*"]\n', 'py/a/pyproject.toml': '' }, ['py/a']],
];

for (const [tool, files, members] of cases) {
  test(`workspaces: ${tool}`, async () => {
    const { json } = runDetect(await makeRepo(files));
    assert.equal(json.state, 'monorepo');
    assert.equal(json.workspaces.tool, tool);
    assert.equal(json.workspaces.total, members.length);
    assert.deepEqual(json.scopes.map((s) => s.path), ['.', ...members]);
  });
}

test('CRLF and BOM in pnpm-workspace.yaml', async () => {
  const dir = await makeRepo({
    'pnpm-workspace.yaml': '﻿packages:\r\n  - "p/*"\r\n',
    'p/a/package.json': '{}',
  });
  const { json } = runDetect(dir);
  assert.equal(json.state, 'monorepo');
  assert.deepEqual(json.scopes.map((s) => s.path), ['.', 'p/a']);
});

test('invalid package.json warns', async () => {
  const { code, json } = runDetect(await makeRepo({ 'package.json': '{oops', 'a.js': 'x' }));
  assert.equal(code, 0);
  assert.equal(json.state, 'single');
  assert.ok(json.warnings.some((w) => /package\.json/.test(w)));
});

test('empty pnpm-workspace.yaml', async () => {
  const { code, json } = runDetect(await makeRepo({ 'pnpm-workspace.yaml': '', 'a.js': 'x' }));
  assert.equal(code, 0);
  assert.equal(json.state, 'single');
  assert.equal(json.workspaces.total, 0);
});

test('glob matching nothing warns', async () => {
  const { json } = runDetect(await makeRepo({ 'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n', 'a.js': 'x' }));
  assert.equal(json.state, 'single');
  assert.ok(json.warnings.some((w) => /packages\/\*/.test(w)));
});

test('fixtures', async () => {
  const pnpm = runDetect(await copyFixture('monorepo-pnpm')).json;
  assert.equal(pnpm.workspaces.tool, 'pnpm');
  assert.equal(pnpm.workspaces.total, 3);
  const cargo = runDetect(await copyFixture('monorepo-cargo')).json;
  assert.equal(cargo.workspaces.tool, 'cargo');
  assert.equal(cargo.workspaces.total, 2);
});
