import { spawnSync } from 'node:child_process';
import { AGENT_DIRS } from './constants.mjs';

const MAX_BUFFER = 256 * 1024 * 1024;

/** Runs git in `root`. Never throws. */
export function git(root, args) {
  try {
    const r = spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    if (r.error || r.status !== 0) return { ok: false, stdout: '' };
    return { ok: true, stdout: r.stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

export function inAgentDir(path) {
  return path.split('/').some((segment) => AGENT_DIRS.includes(segment));
}

const splitZ = (stdout) => stdout.split('\0').filter(Boolean);

/**
 * Lists files below `root` via git. `tracked` counts cached files outside
 * AGENT_DIRS. Returns null when git cannot list (not a repo, git missing).
 */
export function listGitFiles(root) {
  const cached = git(root, ['ls-files', '-z', '--cached']);
  if (!cached.ok) return null;
  const others = git(root, ['ls-files', '-z', '--others', '--exclude-standard']);
  if (!others.ok) return null;
  const cachedFiles = splitZ(cached.stdout).filter((p) => !inAgentDir(p));
  const otherFiles = splitZ(others.stdout).filter((p) => !inAgentDir(p));
  return {
    files: [...new Set([...cachedFiles, ...otherFiles])],
    tracked: new Set(cachedFiles).size,
  };
}

export function gitInfo(root) {
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return { isRepo: false, head: null, trackedFiles: 0 };
  }
  const head = git(root, ['rev-parse', 'HEAD']);
  const listing = listGitFiles(root);
  return {
    isRepo: true,
    head: head.ok ? head.stdout.trim() : null,
    trackedFiles: listing ? listing.tracked : 0,
  };
}

export function isIgnored(root, path) {
  return git(root, ['check-ignore', '-q', '--', path]).ok;
}
