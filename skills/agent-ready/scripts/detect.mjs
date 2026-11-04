#!/usr/bin/env node
import { statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isSourceFile, listFiles, readText } from './lib/files.mjs';
import { changedFiles, commitCounts, gitInfo, inAgentDir } from './lib/git.mjs';
import { analyzeScope, detectPackageManager, detectPublishedDocs } from './lib/scope.mjs';
import { parseStamp } from './lib/stamp.mjs';
import { detectWorkspaces } from './lib/workspaces.mjs';

const USAGE = 'usage: detect.mjs <root> [--scope <path>]';
const MAX_SCOPES = 25;
const HOT_DIRS = 5;
const TOP_CHANGED = 5;
const TOP_CHANGED_DETAIL = 50;

function fail(message) {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(2);
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const positional = [];
  let scope = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--scope') {
      i++;
      if (i >= argv.length || argv[i].startsWith('-')) fail('--scope needs a path');
      scope = argv[i];
    } else if (arg.startsWith('-')) {
      fail(`unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) fail('expected exactly one root path');
  const root = resolve(positional[0]);
  if (!isDirectory(root)) fail(`not a directory: ${positional[0]}`);
  let scopePath = null;
  if (scope !== null) {
    const abs = resolve(root, scope.replaceAll('\\', '/'));
    const rel = relative(root, abs);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`scope is outside the root: ${scope}`);
    if (!isDirectory(abs)) fail(`scope is not a directory: ${scope}`);
    scopePath = rel.split(sep).join('/') || '.';
  }
  return { root, scopePath };
}

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Commit totals per workspace member, in one pass over the per-file counts. */
function memberTotals(members, counts) {
  const totals = new Map(members.map((m) => [m, 0]));
  for (const [file, n] of counts) {
    for (let i = file.lastIndexOf('/'); i > 0; i = file.lastIndexOf('/', i - 1)) {
      const dir = file.slice(0, i);
      if (totals.has(dir)) totals.set(dir, totals.get(dir) + n);
    }
  }
  return totals;
}

/** Top directories by the first two path segments under the scope: recent commits, then file count. */
function hotDirs(files, prefix, counts) {
  const dirs = new Map();
  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const segments = file.slice(prefix.length).split('/');
    if (segments.length < 2) continue;
    const key = prefix + segments.slice(0, Math.min(2, segments.length - 1)).join('/');
    const entry = dirs.get(key) ?? { commits: 0, files: 0 };
    entry.files++;
    entry.commits += counts.get(file) ?? 0;
    dirs.set(key, entry);
  }
  return [...dirs]
    .sort(([an, a], [bn, b]) => b.commits - a.commits || b.files - a.files || byName(an, bn))
    .slice(0, HOT_DIRS)
    .map(([name]) => name);
}

function main() {
  const { root, scopePath } = parseArgs(process.argv.slice(2));
  const listing = listFiles(root);
  const info = gitInfo(root);
  const hasSource = listing.files.some(isSourceFile);
  const ws = detectWorkspaces(root, listing.files);
  const packageManager = detectPackageManager(listing.files);
  const counts = info.isRepo ? commitCounts(root) : new Map();
  const totals = memberTotals(ws.members, counts);
  const members = [...ws.members].sort((a, b) => totals.get(b) - totals.get(a) || byName(a, b));
  const paths = scopePath === null ? ['.', ...members] : [scopePath];
  const detail = scopePath !== null;
  const warnings = [];
  const changedCache = new Map();

  const analyze = (path) => {
    const { warnings: scopeWarnings, ...scope } = analyzeScope(root, path, listing.files, { packageManager, detail });
    warnings.push(...scopeWarnings);
    const prefix = path === '.' ? '' : `${path}/`;
    const stamp = parseStamp(readText(join(root, prefix, 'AGENTS.md')));
    let changedSinceStamp = null;
    if (stamp && stamp.commit !== 'none') {
      if (!changedCache.has(stamp.commit)) changedCache.set(stamp.commit, changedFiles(root, stamp.commit));
      const changed = changedCache.get(stamp.commit);
      if (changed === null) {
        warnings.push(`stamp in ${prefix}AGENTS.md names commit ${stamp.commit}, which is not in this repository`);
      } else {
        const inScope = changed.filter((f) => f.startsWith(prefix) && !inAgentDir(f));
        changedSinceStamp = { files: inScope.length, top: inScope.slice(0, detail ? TOP_CHANGED_DETAIL : TOP_CHANGED) };
      }
    }
    return { ...scope, stamp, changedSinceStamp, hotDirs: hotDirs(listing.files, prefix, counts) };
  };
  const scopes = paths.slice(0, MAX_SCOPES).map(analyze);

  const out = {
    schemaVersion: 1,
    git: {
      isRepo: info.isRepo,
      head: info.head,
      trackedFiles: listing.source === 'git' ? listing.tracked : 0,
    },
    state: ws.members.length > 0 ? 'monorepo' : hasSource ? 'single' : 'empty',
    recommendedStrategy: ws.members.length >= 2 || listing.tracked >= 1000 ? 'parallel' : 'inline',
    workspaces: { tool: ws.tool, total: ws.members.length, truncated: paths.length > MAX_SCOPES },
    publishedDocsSite: detectPublishedDocs(root, listing.files),
    scopes,
    warnings: [...new Set([...listing.warnings, ...ws.warnings, ...warnings])],
  };
  process.stdout.write(JSON.stringify(out));
}

try {
  main();
} catch (e) {
  process.stderr.write(`detect failed: ${e && e.message ? e.message : e}\n`);
  process.exit(2);
}
