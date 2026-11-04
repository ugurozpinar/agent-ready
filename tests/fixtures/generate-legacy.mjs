import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { commitAll } from '../helpers.mjs';

const SUBSYSTEMS = [['core', 0.4], ['ui', 0.3], ['utils', 0.2], ['billing', 0.1]];
const BILLING_COMMITS = 5;
const FILES_PER_BILLING_COMMIT = 10;

/**
 * Builds a legacy-style repository: unequal subsystems under src/, an old initial
 * commit, and recent history concentrated in src/billing (the smallest subsystem).
 */
export async function generateLegacy(dir, { files = 1500 } = {}) {
  await mkdir(dir, { recursive: true });
  const billing = [];
  const jobs = [];
  for (const [name, share] of SUBSYSTEMS) {
    const count = name === 'billing' ? 0 : Math.floor(files * share);
    for (let i = 0; i < count; i++) jobs.push(`src/${name}/m${i % 20}/f${i}.js`);
  }
  const billingCount = Math.max(files - jobs.length, 0);
  for (let i = 0; i < billingCount; i++) billing.push(`src/billing/m${i % 5}/f${i}.js`);
  jobs.push(...billing);

  for (let i = 0; i < jobs.length; i += 100) {
    await Promise.all(jobs.slice(i, i + 100).map(async (rel, j) => {
      const target = join(dir, rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `export const id = ${i + j};\n`);
    }));
  }
  await writeFile(join(dir, 'package.json'), '{"name":"legacy","scripts":{"test":"node --test"}}\n');

  const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  commitAll(dir, 'initial import', { daysAgo: 200 });
  for (let n = 1; n <= BILLING_COMMITS; n++) {
    for (const rel of billing.slice(0, FILES_PER_BILLING_COMMIT)) {
      await writeFile(join(dir, rel), `export const id = 'billing-${n}';\n`);
    }
    commitAll(dir, `billing change ${n}`, { daysAgo: BILLING_COMMITS - n });
  }
}
