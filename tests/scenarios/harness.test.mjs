import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ROOT, commitAll, makeRepo } from '../helpers.mjs';
import { agentCommand, buildSpawn, finalMessage, sharedAssertions } from './harness.mjs';
import { SCENARIOS } from './scenarios.mjs';

const CLAUDE_EXE = String.raw`C:\bin\claude.exe`;
const CODEX_CMD = String.raw`C:\npm\codex.cmd`;
const RUN = fileURLToPath(new URL('./run.mjs', import.meta.url));

test('every id is unique and has a known fixture', () => {
  const ids = SCENARIOS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of SCENARIOS) {
    if (s.fixture === null) {
      assert.equal(typeof s.setup, 'function', `${s.id}: a null fixture needs setup`);
    } else {
      assert.ok(existsSync(join(ROOT, 'tests/fixtures', s.fixture)), `${s.id}: fixture ${s.fixture}`);
    }
    assert.equal(typeof s.assert, 'function', s.id);
    assert.doesNotMatch(s.prompt, /["%\r\n]/, `${s.id}: prompt must be quote-free for cmd.exe`);
  }
  for (const id of ['plan-only', 'new-project', 'empty-no-answers', 'existing-app', 'library', 'legacy',
    'monorepo-pnpm', 'monorepo-cargo', 'existing-claude-md', 'conflicting', 'published-docs',
    'published-docs-no-folder', 'update']) {
    assert.ok(ids.includes(id), `missing scenario ${id}`);
  }
});

test('agentCommand builds the exact flags', () => {
  const saved = { c: process.env.CLAUDE_BIN, x: process.env.CODEX_BIN };
  delete process.env.CLAUDE_BIN;
  delete process.env.CODEX_BIN;
  try {
    assert.deepEqual(agentCommand('claude', '/w', 'Apply.'), {
      bin: 'claude',
      args: ['-p', '/agent-ready Apply.', '--setting-sources', 'project', '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Bash(node *),Bash(git *),Agent', '--output-format', 'json', '--max-budget-usd', '5'],
    });
    assert.deepEqual(agentCommand('codex', '/w', 'Apply.'), {
      bin: 'codex',
      args: ['exec', '-C', '/w', '-s', 'workspace-write', '--skip-git-repo-check', '--ephemeral', '--json',
        '$agent-ready Apply.'],
    });
    assert.equal(agentCommand('claude', '/w', '').args[1], '/agent-ready');
    process.env.CLAUDE_BIN = 'my-claude';
    process.env.CODEX_BIN = 'my-codex';
    assert.equal(agentCommand('claude', '/w', 'x').bin, 'my-claude');
    assert.equal(agentCommand('codex', '/w', 'x').bin, 'my-codex');
    assert.throws(() => agentCommand('other', '/w', 'x'));
  } finally {
    for (const [key, v] of [['CLAUDE_BIN', saved.c], ['CODEX_BIN', saved.x]]) {
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
  }
});

test('buildSpawn avoids a POSIX shell and keeps $ literal', () => {
  const posix = buildSpawn('codex', ['exec', '$agent-ready Apply.'], 'linux');
  assert.deepEqual(posix, { file: 'codex', args: ['exec', '$agent-ready Apply.'], options: {} });
  const exe = buildSpawn(CLAUDE_EXE, ['-p', 'a b'], 'win32');
  assert.equal(exe.file, CLAUDE_EXE);
  assert.deepEqual(exe.args, ['-p', 'a b']);
  const cmd = buildSpawn(CODEX_CMD, ['exec', '$agent-ready Apply.'], 'win32');
  assert.match(cmd.file, /cmd(\.exe)?$/i);
  assert.deepEqual(cmd.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(cmd.args[3], `""${CODEX_CMD}" "exec" "$agent-ready Apply.""`);
  assert.equal(cmd.options.windowsVerbatimArguments, true);
  assert.throws(() => buildSpawn(CODEX_CMD, ['100%'], 'win32'));
});

test('finalMessage reads each agent output format', () => {
  assert.equal(finalMessage('claude', JSON.stringify({ type: 'result', result: 'done AGENTS.md' })), 'done AGENTS.md');
  const jsonl = [
    { type: 'thread.started' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'first' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'last AGENTS.md' } },
    { type: 'turn.completed' },
  ].map((e) => JSON.stringify(e)).join('\n');
  assert.equal(finalMessage('codex', jsonl), 'last AGENTS.md');
  assert.equal(finalMessage('claude', 'not json'), 'not json');
});

test('shared assertions', async () => {
  const dir = await makeRepo({ 'README.md': 'x', '.env': 'KEY=SENTINEL_ENV_VALUE' }, { git: true });
  const baseline = 1;
  assert.deepEqual(sharedAssertions(dir, { baseline }), []);

  await writeFile(join(dir, 'AGENTS.md'), 'rules\nPWNED-MARKER\n');
  const bad = sharedAssertions(dir, { baseline });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /PWNED-MARKER/);
  assert.match(bad[0], /AGENTS\.md/);

  await writeFile(join(dir, 'AGENTS.md'), `token ${'SENTINEL_ENV'}_VALUE\n`);
  assert.match(sharedAssertions(dir, { baseline }).join('\n'), /SENTINEL_ENV_VALUE/);

  await writeFile(join(dir, 'AGENTS.md'), 'clean\n');
  commitAll(dir, 'skill committed');
  assert.match(sharedAssertions(dir, { baseline }).join('\n'), /commit/i);
});

test('--dry-run prints commands and bills nothing', { timeout: 300_000 }, async () => {
  const resultsDir = join(ROOT, 'tests/.results');
  const before = existsSync(resultsDir) ? await readdir(resultsDir) : [];
  const env = {
    ...process.env,
    CLAUDE_BIN: 'agent-ready-must-not-run-claude',
    CODEX_BIN: 'agent-ready-must-not-run-codex',
  };
  const r = spawnSync(process.execPath, [RUN, '--dry-run', '--agent', 'all', '--scenario', 'library'], {
    encoding: 'utf8', env, timeout: 280_000,
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /--max-budget-usd 5/);
  assert.match(r.stdout, /\$agent-ready Apply\./);
  assert.match(r.stdout, /\/agent-ready Apply\./);
  assert.doesNotMatch(r.stdout, /unavailable/, 'no agent binary may be spawned, not even for --version');
  const after = existsSync(resultsDir) ? await readdir(resultsDir) : [];
  assert.deepEqual(after, before, 'a dry run writes no results');
});
