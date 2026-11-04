import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { matchGlob, readText } from './files.mjs';
import { parseStamp } from './stamp.mjs';
import { detectWorkspaces } from './workspaces.mjs';

/**
 * @typedef {{check: string, file: string, message: string}} Finding
 * @typedef {{path: string, agentsPath: string}} Scope
 * @typedef {{root: string, scopes: Scope[], skipClaudeBridge: boolean, files: string[]}} Ctx
 */

export const ROOT_LINES = 120;
export const PACKAGE_LINES = 60;
export const CHAIN_BYTES = 32 * 1024;

const BRIDGE = /(^|\s)@(\.\/)?AGENTS\.md(\s|$)/m;

const prefixOf = (path) => (path === '.' ? '' : `${path}/`);

/** The root scope plus workspace members that have an `AGENTS.md`; only the named scope with `--scope`. */
export function collectScopes(root, scopeArg, files) {
  const scopeFor = (path) => ({ path, agentsPath: `${prefixOf(path)}AGENTS.md` });
  if (scopeArg !== null && scopeArg !== undefined) return [scopeFor(scopeArg)];
  const members = detectWorkspaces(root, files).members.filter((m) => files.includes(`${m}/AGENTS.md`));
  return [scopeFor('.'), ...members.map(scopeFor)];
}

/** Line count of normalized text, ignoring one trailing newline. */
function countLines(text) {
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
}

/** Every `AGENTS.md` from the root down to `path`, as normalized text. */
function chainTexts(root, path) {
  const texts = [];
  let dir = '';
  for (const segment of path === '.' ? [] : path.split('/')) {
    texts.push(readText(join(root, dir, 'AGENTS.md')));
    dir = dir ? `${dir}/${segment}` : segment;
  }
  texts.push(readText(join(root, dir, 'AGENTS.md')));
  return texts.filter((t) => t !== null);
}

function bridgeFinding(root, prefix) {
  const file = `${prefix}CLAUDE.md`;
  const abs = join(root, file);
  let stat;
  try {
    stat = lstatSync(abs);
  } catch {
    return { check: 'claude-bridge', file, message: `${file} is missing; add a line @AGENTS.md or symlink it to AGENTS.md` };
  }
  if (stat.isSymbolicLink()) {
    try {
      if (realpathSync(abs) === realpathSync(join(root, `${prefix}AGENTS.md`))) return null;
    } catch {
      /* dangling link: fall through to the finding */
    }
    return { check: 'claude-bridge', file, message: `${file} is a symlink that does not point to AGENTS.md` };
  }
  const text = readText(abs);
  if (text !== null && BRIDGE.test(text)) return null;
  return { check: 'claude-bridge', file, message: `${file} does not import AGENTS.md; add a line @AGENTS.md` };
}

/** Inline-code tokens of the root `AGENTS.md`, as paths without a leading `./` or trailing `/`. */
function codeTokens(text) {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim().replace(/^\.\//, '').replace(/\/$/, ''));
}

/** @param {Ctx} ctx @returns {{errors: Finding[], warnings: Finding[]}} */
export function runCoreChecks(ctx) {
  const errors = [];
  const warnings = [];
  const error = (check, file, message) => errors.push({ check, file, message });
  const rootText = readText(join(ctx.root, 'AGENTS.md'));
  const tokens = rootText === null ? null : codeTokens(rootText);

  for (const scope of ctx.scopes) {
    const isRoot = scope.path === '.';
    const text = readText(join(ctx.root, scope.agentsPath));
    if (text === null) {
      error('agents-missing', scope.agentsPath, `${scope.agentsPath} does not exist`);
      continue;
    }

    const limit = isRoot ? ROOT_LINES : PACKAGE_LINES;
    const lineCount = countLines(text);
    if (lineCount > limit) error('agents-budget', scope.agentsPath, `${lineCount} lines, over the ${limit}-line budget`);

    const bytes = chainTexts(ctx.root, scope.path).reduce((sum, t) => sum + Buffer.byteLength(t), 0);
    if (bytes > CHAIN_BYTES) error('chain-budget', scope.agentsPath, `AGENTS.md chain is ${bytes} bytes, over the ${CHAIN_BYTES}-byte budget`);

    if (!parseStamp(text)) error('stamp', scope.agentsPath, 'last non-empty line must be `<!-- agent-ready: v=<version> commit=<sha|none> -->`');

    if (!ctx.skipClaudeBridge) {
      const finding = bridgeFinding(ctx.root, prefixOf(scope.path));
      if (finding) errors.push(finding);
    }

    if (!isRoot && tokens !== null) {
      const covered = tokens.some((t) => [scope.path, scope.agentsPath].some((p) => t === p || matchGlob(t, p)));
      if (!covered) error('package-coverage', scope.agentsPath, `root AGENTS.md does not reference ${scope.path} in inline code`);
    }

    if (ctx.files.includes(`${prefixOf(scope.path)}AGENTS.override.md`)) {
      warnings.push({
        check: 'agents-override',
        file: `${prefixOf(scope.path)}AGENTS.override.md`,
        message: 'AGENTS.override.md replaces AGENTS.md for some agents; this is usually a local file',
      });
    }
  }

  return { errors, warnings };
}
