import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');
const DETECT = join(ROOT, 'plugin/skills/agent-ready/scripts/detect.mjs');
const VALIDATE = join(ROOT, 'plugin/skills/agent-ready/scripts/validate.mjs');

function git(dir, args, env = {}) {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export async function makeRepo(files, { git: useGit = false, prefix = 'agent-ready-' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  for (const [name, content] of Object.entries(files)) {
    const target = join(dir, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  if (useGit) {
    git(dir, ['init', '-q']);
    commitAll(dir, 'initial commit');
  }
  return dir;
}

export async function copyFixture(name, { git: useGit = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-ready-fx-'));
  await cp(join(ROOT, 'tests/fixtures', name), dir, { recursive: true });
  if (useGit) {
    git(dir, ['init', '-q']);
    commitAll(dir, 'initial commit');
  }
  return dir;
}

export function commitAll(dir, message, { daysAgo = 0 } = {}) {
  const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const env = {
    GIT_AUTHOR_NAME: 'Test Author',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test Author',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
  git(dir, ['add', '-A'], env);
  git(dir, ['commit', '-q', '--allow-empty', '-m', message], env);
  return git(dir, ['rev-parse', 'HEAD'], env);
}

function runScript(script, dir, args = [], { env, cwd } = {}) {
  const r = spawnSync(process.execPath, [script, dir, ...args], {
    cwd: cwd ?? dir,
    encoding: 'utf8',
    env: env ?? process.env,
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

export const runDetect = (dir, args, opts) => runScript(DETECT, dir, args, opts);
export const runValidate = (dir, args, opts) => runScript(VALIDATE, dir, args, opts);

const quote = (a) => (/^[\w@%+=:,./\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);

export function runNpx(args, { cwd }) {
  const win = process.platform === 'win32';
  const r = win
    ? spawnSync(['npx', ...args.map(quote)].join(' '), {
        cwd, encoding: 'utf8', shell: true, env: { ...process.env, DISABLE_TELEMETRY: '1' },
      })
    : spawnSync('npx', args, {
        cwd, encoding: 'utf8', env: { ...process.env, DISABLE_TELEMETRY: '1' },
      });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export async function listTree(dir) {
  const out = [];
  async function walk(d) {
    for (const entry of await readdir(d)) {
      const full = join(d, entry);
      const s = await stat(full);
      if (s.isDirectory()) await walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  }
  await walk(dir);
  return out.sort();
}

export function envWithoutGit() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^path$/i.test(key)) delete env[key];
  env.PATH = '';
  return env;
}
