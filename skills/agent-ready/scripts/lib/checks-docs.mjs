import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { readJson, readText } from './files.mjs';
import { gitInfo, isIgnored } from './git.mjs';
import { detectWorkspaces } from './workspaces.mjs';

/** @typedef {import('./checks-core.mjs').Ctx} Ctx @typedef {import('./checks-core.mjs').Finding} Finding */

export const MEMORY_LINES = 200;

const PRODUCT_DOCS = ['voice-and-tone.md', 'personas.md', 'product-overview.md', 'design-system.md'];
const MEMORY_DOC = 'ai-memory.md';

const SECRET_PATTERNS = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws-access-key', /AKIA[0-9A-Z]{16}/],
  ['github-token', /ghp_[A-Za-z0-9]{36}/],
  ['github-pat', /github_pat_[A-Za-z0-9_]{22,}/],
  ['api-key-sk', /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/],
  ['slack-token', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['gitlab-token', /glpat-[A-Za-z0-9_-]{20,}/],
];

const PM_BUILTINS = new Set((
  'install i add remove update up exec dlx create init why list ls audit outdated link unlink publish pack rebuild '
  + 'store config import fetch prune patch dedupe bin root help version upgrade workspaces global cache info login logout'
).split(' '));
const NPM_SCRIPT_ALIASES = new Set(['test', 'start', 'stop', 'restart']);
const UNVERIFIABLE = /&&|\||;|--filter|workspace/;

const prefixOf = (path) => (path === '.' ? '' : `${path}/`);
const baseName = (path) => path.slice(path.lastIndexOf('/') + 1);

function countLines(text) {
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
}

/** Splits Markdown into prose (fenced lines blanked) and the fenced lines themselves. */
function splitFences(text) {
  const prose = [];
  const fenced = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      fenced.push(line);
      prose.push('');
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
    } else if (m) {
      fence = m[1];
      prose.push('');
    } else {
      prose.push(line);
    }
  }
  return { prose: prose.join('\n'), fenced };
}

const isUrlLike = (target) => /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');

function decode(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** Reference targets in prose: Markdown link targets and inline-code tokens ending in `.md`. */
function referencesIn(prose) {
  const refs = new Set();
  for (const m of prose.matchAll(/\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g)) {
    const target = m[1].split('#')[0];
    if (target && !isUrlLike(target)) refs.add(decode(target));
  }
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    const token = m[1].trim();
    if (/\s/.test(token) || !token.endsWith('.md') || isUrlLike(token)) continue;
    refs.add(token);
  }
  return [...refs];
}

/** Candidate command strings: inline code in prose and every fenced line. */
function commandCandidates(prose, fenced) {
  const out = [];
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) out.push(m[1]);
  for (const line of fenced) out.push(line.replace(/^\s*\$\s+/, '').replace(/\s+#.*$/, ''));
  return out.map((c) => c.trim()).filter(Boolean);
}

/** Script/target the command needs, or null when it is not verifiable. */
function parseCommand(candidate) {
  if (UNVERIFIABLE.test(candidate)) return null;
  const words = candidate.split(/\s+/);
  if (words.some((w) => w === '-C' || w === '-F')) return null;
  const [tool, first, second] = words;
  const plain = (w) => (w && !w.startsWith('-') ? w : null);
  switch (tool) {
    case 'npm':
      if (NPM_SCRIPT_ALIASES.has(first)) return { kind: 'script', tool, name: first };
      return first === 'run' && plain(second) ? { kind: 'script', tool, name: second } : null;
    case 'pnpm':
    case 'yarn':
      if (first === 'run') return plain(second) ? { kind: 'script', tool, name: second } : null;
      return plain(first) && !PM_BUILTINS.has(first) ? { kind: 'script', tool, name: first } : null;
    case 'bun':
      return first === 'run' && plain(second) ? { kind: 'script', tool, name: second } : null;
    case 'make':
      return plain(first) && !first.includes('=') ? { kind: 'make', tool, name: first } : null;
    case 'just':
      return plain(first) && !first.includes('::') && !first.includes('=') ? { kind: 'just', tool, name: first } : null;
    default:
      return null;
  }
}

const firstExisting = (root, dir, names) => names.map((n) => join(root, dir, n)).find((p) => existsSync(p)) ?? null;

function makeTargets(text) {
  const targets = new Set();
  for (const line of text.split('\n')) {
    const m = /^([^\s#:=\t][^:=#]*?)\s*::?(?!=)/.exec(line);
    if (m) for (const t of m[1].split(/\s+/)) targets.add(t);
  }
  return targets;
}

function justRecipes(text) {
  const recipes = new Set();
  for (const line of text.split('\n')) {
    if (/^\s/.test(line) || /^[A-Za-z_][\w-]*\s*:?=/.test(line) || /^(export|set|import|mod|alias)\s/.test(line)) continue;
    const m = /^@?([A-Za-z_][\w-]*)\b[^\n]*?:(?!=)/.exec(line);
    if (m) recipes.add(m[1]);
  }
  return recipes;
}

/** @param {Ctx} ctx @returns {{errors: Finding[], warnings: Finding[]}} */
export function runDocChecks(ctx) {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const error = (check, file, message) => {
    const key = `${check}\0${file}\0${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    errors.push({ check, file, message });
  };
  const abs = (rel) => join(ctx.root, rel);

  const scriptCache = new Map();
  /** Script names of `dir/package.json`; null when the file is absent. */
  const scriptsOf = (dir) => {
    if (!scriptCache.has(dir)) {
      const path = abs(dir === '.' ? 'package.json' : `${dir}/package.json`);
      if (readText(path) === null) {
        scriptCache.set(dir, null);
      } else {
        const { value } = readJson(path);
        const scripts = value && typeof value.scripts === 'object' && value.scripts ? Object.keys(value.scripts) : [];
        scriptCache.set(dir, new Set(scripts));
      }
    }
    return scriptCache.get(dir);
  };
  let members = null;
  const memberDirs = () => (members ??= detectWorkspaces(ctx.root, ctx.files).members);

  const verifyCommand = (cmd, scope, agentsPath) => {
    const dir = scope.path;
    const label = `${cmd.tool} ${cmd.name}`;
    if (cmd.kind === 'script') {
      const sources = [scriptsOf(dir)];
      if (dir === '.') sources.push(...memberDirs().map(scriptsOf));
      const present = sources.filter((s) => s !== null);
      if (present.length === 0) {
        error('unknown-command', agentsPath, `\`${label}\`: no package.json for ${cmd.tool} in ${dir === '.' ? 'the root or its workspace members' : dir}`);
      } else if (!present.some((s) => s.has(cmd.name))) {
        error('unknown-command', agentsPath, `\`${label}\`: no script "${cmd.name}" in package.json`);
      }
      return;
    }
    const names = cmd.kind === 'make' ? ['Makefile', 'makefile', 'GNUmakefile'] : ['justfile', 'Justfile', '.justfile'];
    const file = firstExisting(ctx.root, prefixOf(dir), names);
    if (file === null) {
      error('unknown-command', agentsPath, `\`${label}\`: no ${names[0]} in ${dir}`);
      return;
    }
    const text = readText(file) ?? '';
    const known = cmd.kind === 'make' ? makeTargets(text) : justRecipes(text);
    if (!known.has(cmd.name)) error('unknown-command', agentsPath, `\`${label}\`: no ${cmd.kind === 'make' ? 'target' : 'recipe'} "${cmd.name}"`);
  };

  const productDocs = new Set();
  const scanFiles = new Set();
  const memoryFiles = new Set();

  for (const scope of ctx.scopes) {
    const prefix = prefixOf(scope.path);
    const text = readText(abs(scope.agentsPath));
    if (text === null) continue;
    scanFiles.add(scope.agentsPath);
    if (existsSync(abs(`${prefix}CLAUDE.md`))) scanFiles.add(`${prefix}CLAUDE.md`);

    const { prose, fenced } = splitFences(text);

    for (const ref of referencesIn(prose)) {
      const resolved = ref.startsWith('/') ? posix.normalize(ref.slice(1)) : posix.join(scope.path === '.' ? '.' : scope.path, ref);
      if (ref.includes('*')) continue;
      const rel = resolved.replace(/\/$/, '');
      if (!existsSync(abs(rel))) {
        error('broken-path', scope.agentsPath, `${ref} does not exist (resolved to ${rel})`);
        continue;
      }
      if (PRODUCT_DOCS.includes(baseName(rel))) productDocs.add(rel);
      if (baseName(rel) === MEMORY_DOC) memoryFiles.add(rel);
    }

    for (const name of [...PRODUCT_DOCS, MEMORY_DOC]) {
      const rel = `${prefix}docs/ai/${name}`;
      if (!ctx.files.includes(rel) && !existsSync(abs(rel))) continue;
      if (name === MEMORY_DOC) memoryFiles.add(rel);
      else productDocs.add(rel);
    }

    for (const candidate of commandCandidates(prose, fenced)) {
      const cmd = parseCommand(candidate);
      if (cmd) verifyCommand(cmd, scope, scope.agentsPath);
    }

    for (const m of text.matchAll(/\{\{ar:[^}\n]*\}\}/g)) {
      error('template-marker', scope.agentsPath, `unfilled template marker ${m[0]}`);
    }
  }

  for (const doc of productDocs) {
    scanFiles.add(doc);
    const text = readText(abs(doc));
    if (text === null) continue;
    const status = text.split('\n').slice(0, 10).map((l) => /^Status: (draft|confirmed)$/.exec(l)).find(Boolean);
    const hasOpen = /^## Open questions$/m.test(text);
    if (!status) error('doc-status', doc, 'first 10 lines must contain `Status: draft` or `Status: confirmed`');
    else if (status[1] === 'draft' && !hasOpen) error('open-questions', doc, 'a draft document needs a `## Open questions` section');
    else if (status[1] === 'confirmed' && hasOpen) error('open-questions', doc, 'a confirmed document must not keep a `## Open questions` section');
    for (const m of text.matchAll(/\{\{ar:[^}\n]*\}\}/g)) error('template-marker', doc, `unfilled template marker ${m[0]}`);
  }

  for (const doc of memoryFiles) {
    scanFiles.add(doc);
    const text = readText(abs(doc));
    const count = text === null ? 0 : countLines(text);
    if (count > MEMORY_LINES) warnings.push({ check: 'memory-budget', file: doc, message: `${count} lines, over the ${MEMORY_LINES}-line budget` });
  }

  const inGit = gitInfo(ctx.root).isRepo;
  for (const file of scanFiles) {
    const text = readText(abs(file));
    if (text === null) continue;
    if (inGit && isIgnored(ctx.root, file)) error('git-ignored', file, `${file} is ignored by git; it must be committed`);
    text.split('\n').forEach((line, i) => {
      for (const [name, pattern] of SECRET_PATTERNS) {
        if (pattern.test(line)) error('secret', file, `possible secret (${name}) at line ${i + 1}`);
      }
    });
  }

  return { errors, warnings };
}
