import { join } from 'node:path';
import { matchGlob, readJson, readText } from './files.mjs';

const MANIFESTS = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'project.json'];

/** Removes a trailing `# comment`, ignoring `#` inside quotes. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, '$2').trim();

/** Items of a top-level `key:` list in a flat YAML file: the `- value` lines under it. */
function yamlList(text, key) {
  const items = [];
  let inKey = false;
  for (const raw of text.split('\n')) {
    const line = stripComment(raw).replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      inKey = line.startsWith(`${key}:`);
      continue;
    }
    const m = inKey && /^\s*-\s+(.+)$/.exec(line);
    if (m) items.push(unquote(m[1]));
  }
  return items;
}

/** Body of a `[header]` TOML table, up to the next table. */
function tomlTable(text, header) {
  const lines = [];
  let inside = false;
  for (const raw of text.split('\n')) {
    const line = stripComment(raw);
    if (/^\s*\[/.test(line) && !/^\s*\[\s*["']/.test(line)) {
      inside = line.trim() === `[${header}]`;
      continue;
    }
    if (inside) lines.push(line);
  }
  return lines.join('\n');
}

/** Quoted strings of `key = [ ... ]` (possibly multi-line) inside a table body. */
function tomlStrings(body, key) {
  const m = new RegExp(`(?:^|\\n)\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`).exec(body);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]*)"|'([^']*)'/g)].map((x) => x[1] ?? x[2]);
}

/** Paths of `use ./a` and `use ( ./a ./b )` in go.work. */
function goUses(text) {
  const uses = [];
  let block = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (block) {
      if (line === ')') block = false;
      else uses.push(unquote(line));
    } else if (/^use\s*\(\s*$/.test(line)) {
      block = true;
    } else {
      const m = /^use\s+(\S+)$/.exec(line);
      if (m) uses.push(unquote(m[1]));
    }
  }
  return uses;
}

const normalize = (p) => p.replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * Resolves include/exclude patterns against candidate member directories.
 * Negated includes (`!x`) act as excludes. Warns for includes that match nothing.
 */
function resolveMembers(includes, excludes, dirs, source, warnings) {
  const inc = [];
  const exc = excludes.map(normalize);
  for (const raw of includes) {
    if (raw.startsWith('!')) exc.push(normalize(raw.slice(1)));
    else inc.push(normalize(raw));
  }
  const found = new Set();
  for (const pattern of inc) {
    const hits = dirs.filter((d) => matchGlob(pattern, d));
    if (hits.length === 0) warnings.push(`${source}: pattern "${pattern}" matched no package`);
    for (const d of hits) found.add(d);
  }
  return [...found].filter((d) => !exc.some((e) => matchGlob(e, d)));
}

/**
 * Finds workspace members. `files` are root-relative POSIX paths.
 * Returns members sorted (root excluded) and any warnings.
 */
export function detectWorkspaces(root, files) {
  const warnings = [];
  const has = (name) => files.includes(name);
  const dirs = [...new Set(
    files
      .filter((f) => f.includes('/') && MANIFESTS.includes(f.slice(f.lastIndexOf('/') + 1)))
      .map((f) => f.slice(0, f.lastIndexOf('/'))),
  )].sort();
  const found = []; // [tool, members] in priority order

  const jsonFile = (name) => {
    if (!has(name)) return null;
    const { value, error } = readJson(join(root, name));
    if (error) {
      warnings.push(`${name} could not be parsed: ${error}`);
      return null;
    }
    return value;
  };

  if (has('pnpm-workspace.yaml')) {
    const text = readText(join(root, 'pnpm-workspace.yaml')) ?? '';
    found.push(['pnpm', resolveMembers(yamlList(text, 'packages'), [], dirs, 'pnpm-workspace.yaml', warnings)]);
  }

  const pkg = jsonFile('package.json');
  if (pkg && pkg.workspaces) {
    const list = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages;
    const patterns = Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
    found.push([has('yarn.lock') ? 'yarn' : 'npm', resolveMembers(patterns, [], dirs, 'package.json', warnings)]);
  }

  const lerna = jsonFile('lerna.json');
  if (lerna) {
    const patterns = Array.isArray(lerna.packages) ? lerna.packages : ['packages/*'];
    found.push(['lerna', resolveMembers(patterns, [], dirs, 'lerna.json', warnings)]);
  }

  const nxDirs = files
    .filter((f) => f.endsWith('/project.json'))
    .map((f) => f.slice(0, -'/project.json'.length));
  if (has('nx.json')) found.push(['nx', nxDirs]);

  if (has('Cargo.toml')) {
    const body = tomlTable(readText(join(root, 'Cargo.toml')) ?? '', 'workspace');
    const members = resolveMembers(tomlStrings(body, 'members'), tomlStrings(body, 'exclude'), dirs, 'Cargo.toml', warnings);
    found.push(['cargo', members]);
  }

  if (has('go.work')) {
    const uses = goUses(readText(join(root, 'go.work')) ?? '');
    found.push(['go', resolveMembers(uses, [], dirs, 'go.work', warnings)]);
  }

  if (has('pyproject.toml')) {
    const body = tomlTable(readText(join(root, 'pyproject.toml')) ?? '', 'tool.uv.workspace');
    const members = resolveMembers(tomlStrings(body, 'members'), tomlStrings(body, 'exclude'), dirs, 'pyproject.toml', warnings);
    found.push(['uv', members]);
  }

  const members = [...new Set(found.flatMap(([, m]) => m))].filter((m) => m !== '.' && m !== '').sort();
  if (members.length === 0) return { tool: null, members: [], warnings };

  const configTool = ['nx', 'turbo', 'lerna'].find((t) => (t === 'lerna' ? lerna : has(`${t}.json`)));
  const sourceTool = found.find(([, m]) => m.length > 0)[0];
  return { tool: configTool ?? sourceTool, members, warnings };
}
