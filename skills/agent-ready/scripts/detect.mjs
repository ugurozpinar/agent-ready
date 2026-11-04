#!/usr/bin/env node
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { isSourceFile, listFiles } from './lib/files.mjs';
import { gitInfo } from './lib/git.mjs';
import { detectWorkspaces } from './lib/workspaces.mjs';

const USAGE = 'usage: detect.mjs <root>';
const MAX_SCOPES = 25;

function fail(message) {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith('-')) fail(`unknown option: ${arg}`);
    positional.push(arg);
  }
  if (positional.length !== 1) fail('expected exactly one root path');
  const root = resolve(positional[0]);
  let isDir = false;
  try {
    isDir = statSync(root).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) fail(`not a directory: ${positional[0]}`);
  return { root };
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const listing = listFiles(root);
  const info = gitInfo(root);
  const hasSource = listing.files.some(isSourceFile);
  const ws = detectWorkspaces(root, listing.files);
  const countIn = (dir) => listing.files.filter((f) => f.startsWith(`${dir}/`)).length;
  const scopes = [
    { path: '.', files: listing.files.length },
    ...ws.members.map((path) => ({ path, files: countIn(path) })),
  ];

  const out = {
    schemaVersion: 1,
    git: {
      isRepo: info.isRepo,
      head: info.head,
      trackedFiles: listing.source === 'git' ? listing.tracked : 0,
    },
    state: ws.members.length > 0 ? 'monorepo' : hasSource ? 'single' : 'empty',
    recommendedStrategy: ws.members.length >= 2 || listing.tracked >= 1000 ? 'parallel' : 'inline',
    workspaces: { tool: ws.tool, total: ws.members.length, truncated: scopes.length > MAX_SCOPES },
    publishedDocsSite: null,
    scopes: scopes.slice(0, MAX_SCOPES),
    warnings: [...new Set([...listing.warnings, ...ws.warnings])],
  };
  process.stdout.write(JSON.stringify(out));
}

try {
  main();
} catch (e) {
  process.stderr.write(`detect failed: ${e && e.message ? e.message : e}\n`);
  process.exit(2);
}
