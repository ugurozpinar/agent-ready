import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { matchGlob, readJson, readText } from './files.mjs';

const UI_DEPS = ['react', 'react-dom', 'vue', 'svelte', '@angular/core', 'next', 'nuxt', 'solid-js',
  'preact', 'lit', 'astro', 'expo', 'react-native', 'electron'];
const UI_EXTENSIONS = ['.tsx', '.jsx', '.vue', '.svelte', '.xaml', '.storyboard'];
const TEXT_EXTENSIONS = ['.po', '.arb', '.xcstrings', '.resx'];
const TEXT_DIRS = ['locales', 'i18n', 'lang', 'translations'];
const DEPLOY_FILES = ['Dockerfile', 'Procfile', 'fly.toml', 'vercel.json', 'netlify.toml'];
const SCRIPT_NAMES = ['test', 'lint', 'build', 'dev', 'start', 'typecheck', 'format', 'check', 'e2e'];
const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md',
  'AGENTS.override.md', '.cursorrules', '.github/copilot-instructions.md'];
const DOC_PREFIXES = ['readme', 'contributing', 'architecture'];
const ADR_DIRS = ['docs/adr/', 'docs/decisions/', 'adr/'];

const SITE_CONFIGS = [
  ['docusaurus', 'docusaurus.config.*'],
  ['mkdocs', 'mkdocs.yml'],
  ['vitepress', 'docs/.vitepress/config.*'],
  ['sphinx', 'conf.py'],
  ['sphinx', 'docs/conf.py'],
  ['jekyll', '_config.yml'],
  ['jekyll', 'docs/_config.yml'],
];

/** The package manager implied by the root lock file; npm when there is none. */
export function detectPackageManager(files) {
  if (files.includes('pnpm-lock.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  if (files.includes('bun.lock') || files.includes('bun.lockb')) return 'bun';
  return 'npm';
}

/** Name of the first published docs site config found, or null. */
export function detectPublishedDocs(root, files) {
  for (const [site, pattern] of SITE_CONFIGS) {
    if (files.some((f) => matchGlob(pattern, f))) return site;
  }
  return null;
}

function scriptCommand(pm, name) {
  if (pm === 'bun') return `bun run ${name}`;
  if (pm === 'npm') return name === 'test' || name === 'start' ? `npm ${name}` : `npm run ${name}`;
  return `${pm} ${name}`;
}

function targetNames(text, pattern) {
  const names = [];
  for (const line of text.split('\n')) {
    const m = pattern.exec(line);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

function ciCommands(root, files) {
  const out = [];
  const workflows = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
  for (const file of workflows) {
    const text = readText(join(root, file));
    if (text === null) continue;
    for (const line of text.split('\n')) {
      const m = /^\s*(?:-\s+)?run:\s+(.+?)\s*$/.exec(line);
      if (!m) continue;
      const value = m[1].replace(/^(["'])(.*)\1$/, '$2');
      if (/^[|>][+-]?\d*$/.test(value) || value.startsWith('#')) continue;
      out.push({ name: 'ci', command: value, source: file });
    }
  }
  return out;
}

function instructionKind(abs, name, readable) {
  let stat;
  try {
    stat = lstatSync(abs);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink()) return name.endsWith('CLAUDE.md') ? 'symlink' : 'content';
  if (!stat.isFile()) return null;
  if (!name.endsWith('CLAUDE.md')) return 'content';
  const lines = (readable(abs) ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => l.startsWith('@')) ? 'bridge' : 'content';
}

/**
 * Hint-level analysis of one scope. `files` are all project files relative to `root`.
 * Reads manifests and named config files only.
 */
export function analyzeScope(root, scopePath, files, { packageManager = 'npm', detail = false } = {}) {
  const warnings = [];
  const prefix = scopePath === '.' ? '' : `${scopePath}/`;
  const scoped = files.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
  const has = (name) => scoped.includes(name);
  const read = (name) => readText(join(root, prefix, name));
  const ext = (f) => f.slice(f.lastIndexOf('.')).toLowerCase();

  let pkg = null;
  if (has('package.json')) {
    const { value, error } = readJson(join(root, prefix, 'package.json'));
    if (error) warnings.push(`${prefix}package.json could not be parsed: ${error}`);
    else if (value && typeof value === 'object') pkg = value;
  }
  const deps = new Set(['dependencies', 'devDependencies', 'peerDependencies']
    .flatMap((key) => Object.keys((pkg && pkg[key]) || {})));

  // Stacks
  const stacks = [];
  const add = (stack, when = true) => { if (when && !stacks.includes(stack)) stacks.push(stack); };
  add('javascript', has('package.json'));
  add('typescript', has('tsconfig.json') || deps.has('typescript'));
  add('react', deps.has('react'));
  add('vue', deps.has('vue'));
  add('svelte', deps.has('svelte'));
  add('angular', deps.has('@angular/core'));
  add('next', deps.has('next'));
  add('nuxt', deps.has('nuxt'));
  add('rust', has('Cargo.toml'));
  add('go', has('go.mod'));
  add('python', ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'].some(has));
  add('ruby', has('Gemfile'));
  add('php', has('composer.json'));
  add('java', ['pom.xml', 'build.gradle', 'build.gradle.kts'].some(has));
  add('dotnet', scoped.some((f) => /\.(csproj|sln)$/.test(f)));
  add('swift', has('Package.swift') || scoped.some((f) => /^[^/]+\.xcodeproj\//.test(f)));
  add('dart', has('pubspec.yaml'));

  // Signals
  const hasDir = (dir) => scoped.some((f) => f.startsWith(`${dir}/`));
  const pubspec = has('pubspec.yaml') ? read('pubspec.yaml') : null;
  const ui = UI_DEPS.some((d) => deps.has(d))
    || scoped.some((f) => UI_EXTENSIONS.includes(ext(f)) || matchGlob('templates/*.html', f))
    || scoped.some((f) => /^tailwind\.config\.[^/]+$/.test(f))
    || hasDir('app/views')
    || (pubspec !== null && pubspec.includes('flutter'));
  const bin = Boolean(pkg && pkg.bin);
  const userText = ui
    || scoped.some((f) => TEXT_EXTENSIONS.includes(ext(f)) || f.split('/').slice(0, -1).some((s) => TEXT_DIRS.includes(s)))
    || bin || has('src/main.rs') || hasDir('cmd');
  const product = ui || bin || has('src/main.rs')
    || scoped.some((f) => DEPLOY_FILES.includes(f) || f.startsWith('docker-compose'));

  // Command candidates
  const candidates = [];
  const push = (name, command, source) => candidates.push({ name, command, source });
  if (pkg && pkg.scripts && typeof pkg.scripts === 'object') {
    for (const name of SCRIPT_NAMES) {
      if (name in pkg.scripts) push(name, scriptCommand(packageManager, name), 'package.json');
    }
  }
  const makefile = ['Makefile', 'GNUmakefile', 'makefile'].find(has);
  if (makefile) {
    for (const t of targetNames(read(makefile) ?? '', /^([A-Za-z0-9_][\w.-]*)\s*:(?![=:])/)) {
      push(t, `make ${t}`, makefile);
    }
  }
  const justfile = ['justfile', 'Justfile', '.justfile'].find(has);
  if (justfile) {
    for (const r of targetNames(read(justfile) ?? '', /^@?([A-Za-z_][\w-]*)(?:\s+[^:=]*)?:(?![=:])/)) {
      push(r, `just ${r}`, justfile);
    }
  }
  if (has('Cargo.toml')) { push('test', 'cargo test', 'Cargo.toml'); push('build', 'cargo build', 'Cargo.toml'); }
  if (has('go.mod')) { push('test', 'go test ./...', 'go.mod'); push('build', 'go build ./...', 'go.mod'); }
  const pyproject = has('pyproject.toml') ? read('pyproject.toml') ?? '' : '';
  if (pyproject.includes('[tool.pytest')) push('test', 'pytest', 'pyproject.toml');
  else if (has('pytest.ini')) push('test', 'pytest', 'pytest.ini');
  if (pyproject.includes('[tool.ruff]')) push('lint', 'ruff check', 'pyproject.toml');
  if (scopePath === '.') candidates.push(...ciCommands(root, files));
  const seen = new Set();
  const commandCandidates = candidates
    .filter((c) => (seen.has(c.command) ? false : seen.add(c.command)))
    .slice(0, detail ? 30 : 10);

  // Docs
  const topDocs = DOC_PREFIXES.flatMap((p) => scoped.filter((f) => !f.includes('/') && f.toLowerCase().startsWith(p)));
  const adrDocs = scoped.filter((f) => ADR_DIRS.some((d) => f.startsWith(d)));
  const docs = [...topDocs, ...adrDocs].slice(0, detail ? 30 : 5).map((f) => prefix + f);

  // Instruction files are read from disk so gitignored ones are found
  const instructionFiles = [];
  for (const name of INSTRUCTION_FILES) {
    const kind = instructionKind(join(root, prefix, name), name, readText);
    if (kind) instructionFiles.push({ path: prefix + name, kind });
  }

  return {
    path: scopePath,
    stacks,
    files: scoped.length,
    signals: { ui, userText, product },
    commandCandidates,
    docs,
    instructionFiles,
    warnings,
  };
}
