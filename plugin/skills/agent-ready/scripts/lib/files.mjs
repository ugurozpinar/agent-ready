import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_DIRS, IGNORED_DIRS } from './constants.mjs';
import { inAgentDir, listGitFiles } from './git.mjs';

export { AGENT_DIRS, IGNORED_DIRS };

const NON_SOURCE_EXT = ['.md', '.mdx', '.txt', '.rst'];
const NON_SOURCE_NAMES = ['.gitignore', '.gitattributes', '.editorconfig', '.gitkeep', 'skills-lock.json'];
const NON_SOURCE_PREFIXES = ['license', 'copying', 'notice'];

/** Reads UTF-8 text, strips a BOM, normalizes CRLF to LF. Null when unreadable. */
export function readText(absPath) {
  try {
    return readFileSync(absPath, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
}

/** Never throws. */
export function readJson(absPath) {
  const text = readText(absPath);
  if (text === null) return { value: null, error: 'unreadable' };
  try {
    return { value: JSON.parse(text), error: null };
  } catch (e) {
    return { value: null, error: e.message };
  }
}

export function isSourceFile(path) {
  const lower = path.toLowerCase();
  if (lower.startsWith('.github/') || lower.startsWith('docs/')) return false;
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  if (NON_SOURCE_NAMES.includes(base)) return false;
  if (NON_SOURCE_PREFIXES.some((p) => base.startsWith(p))) return false;
  if (NON_SOURCE_EXT.some((ext) => base.endsWith(ext))) return false;
  return true;
}

const REGEX_SPECIAL = /[.+?^${}()|[\]\\/]/g;

/** `*` matches within one segment, `**` matches any depth. */
export function matchGlob(pattern, path) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else {
      re += c.replace(REGEX_SPECIAL, '\\$&');
    }
  }
  return new RegExp(`^${re}$`).test(path);
}

function walk(root) {
  const files = [];
  const visit = (dirAbs, dirRel) => {
    let entries;
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.includes(entry.name) || AGENT_DIRS.includes(entry.name)) continue;
        visit(join(dirAbs, entry.name), rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };
  visit(root, '');
  return files;
}

/** Lists project files relative to `root`, with forward slashes. */
export function listFiles(root) {
  const warnings = [];
  const listing = listGitFiles(root);
  if (listing) {
    return {
      files: listing.files.filter((p) => !inAgentDir(p)).sort(),
      tracked: listing.tracked,
      source: 'git',
      warnings,
    };
  }
  if (existsSync(join(root, '.git'))) {
    warnings.push('git could not list files; fell back to a directory walk');
  }
  const files = walk(root).sort();
  return { files, tracked: files.length, source: 'walk', warnings };
}
