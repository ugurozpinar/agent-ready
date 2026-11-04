import assert from 'node:assert/strict';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { ROOT, listTree, makeRepo, runNpx } from '../helpers.mjs';

const probes = {
  'references/workflows/probe.md': 'probe\n',
  'assets/templates/probe.md': 'probe\n',
  'scripts/lib/probe.mjs': 'export const probe = 1;\n',
};

test('install copies every skill file for both agents', {
  timeout: 300_000,
  skip: process.env.AGENT_READY_SKIP_INSTALL_TEST === '1',
}, async () => {
  const source = await makeRepo({ 'README.md': 'source' });
  const skillDir = join(source, 'skills/agent-ready');
  await cp(join(ROOT, 'skills/agent-ready'), skillDir, { recursive: true });
  for (const [rel, content] of Object.entries(probes)) {
    await mkdir(dirname(join(skillDir, rel)), { recursive: true });
    await writeFile(join(skillDir, rel), content);
  }
  const expected = await listTree(skillDir);

  for (const mode of [['--copy'], []]) {
    const cwd = await makeRepo({ 'README.md': 'x' });
    const r = runNpx(['--yes', 'skills@latest', 'add', source, '-a', 'claude-code', 'codex',
      '-s', 'agent-ready', '-y', ...mode], { cwd });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    for (const dir of ['.claude/skills/agent-ready', '.agents/skills/agent-ready']) {
      assert.deepEqual(await listTree(join(cwd, dir)), expected, `${dir} mode=${mode.join('') || 'default'}`);
    }
  }
});
