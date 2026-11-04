import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, commitAll } from '../helpers.mjs';
import { generateLegacy } from '../fixtures/generate-legacy.mjs';
import { commitCount, sharedAssertions } from './harness.mjs';

const exists = (dir, rel) => existsSync(join(dir, rel));
const read = (dir, rel) => (exists(dir, rel) ? readFileSync(join(dir, rel), 'utf8') : '');
const lineCount = (text) => text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
const porcelain = (dir) => spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
const head = (dir, rev = 'HEAD') => spawnSync('git', ['rev-parse', rev], { cwd: dir, encoding: 'utf8' }).stdout.trim();
const stampCommit = (text) => /<!-- agent-ready: v=\S+ commit=(\S+) -->/.exec(text)?.[1] ?? null;

/** Failure message for each path that should exist and does not. */
const mustExist = (dir, paths) => paths.filter((p) => !exists(dir, p)).map((p) => `${p} was not created`);
const mustNotExist = (dir, paths) => paths.filter((p) => exists(dir, p)).map((p) => `${p} must not exist`);
const mustContain = (text, needle, label) => (text.includes(needle) ? [] : [`${label} lacks ${needle}`]);
const mustMention = (message, pattern, what) => (pattern.test(message) ? [] : [`final message does not mention ${what}`]);

const ALL_DOCS = ['AGENTS.md', 'CLAUDE.md', 'docs/ai/ai-memory.md', 'docs/ai/product-overview.md',
  'docs/ai/voice-and-tone.md', 'docs/ai/personas.md', 'docs/ai/design-system.md'];

// Prompts avoid double quotes and percent signs: they reach cmd.exe on Windows.
export const SCENARIOS = [
  {
    id: 'plan-only',
    fixture: 'app-ui',
    prompt: '',
    validate: false, // writes nothing
    assert: (dir, message) => [
      ...(porcelain(dir) === '' ? [] : ['working tree is not clean after a plan-only run']),
      ...mustMention(message, /AGENTS\.md/, 'AGENTS.md'),
    ],
  },
  {
    id: 'new-project',
    fixture: 'empty',
    prompt: 'Apply. Product answers: the product is Acme Tasks, a task tracker for small teams. '
      + 'Its users are team leads and engineers. It exists to cut weekly planning time.',
    assert: (dir) => mustExist(dir, ['AGENTS.md', 'CLAUDE.md', 'docs/ai/ai-memory.md', 'docs/ai/product-overview.md']),
  },
  {
    id: 'empty-no-answers',
    fixture: 'empty',
    prompt: 'Apply. I have no answers to the product questions, skip them.',
    validate: false, // writes nothing
    assert: (dir) => (porcelain(dir) === '' ? [] : ['an empty repository offers no source, yet files were written']),
  },
  {
    id: 'existing-app',
    fixture: 'app-ui',
    prompt: 'Apply.',
    assert: (dir) => [
      ...mustExist(dir, ALL_DOCS),
      ...mustContain(read(dir, 'AGENTS.md'), 'npm test', 'AGENTS.md'),
      ...(/^Status:\s*draft/m.test(read(dir, 'docs/ai/personas.md')) ? [] : ['personas.md is not draft']),
      ...(exists(dir, 'tests/app.test.ts')
        && read(dir, 'tests/app.test.ts') === readFileSync(join(ROOT, 'tests/fixtures/app-ui/tests/app.test.ts'), 'utf8')
        ? [] : ['tests/ was changed or removed']),
    ],
  },
  {
    id: 'library',
    fixture: 'library',
    prompt: 'Apply.',
    assert: (dir) => [
      ...mustExist(dir, ['AGENTS.md', 'CLAUDE.md', 'docs/ai/ai-memory.md']),
      ...mustNotExist(dir, ['docs/ai/design-system.md', 'docs/ai/personas.md']),
    ],
  },
  {
    id: 'legacy',
    fixture: null,
    prompt: 'Apply.',
    setup: (dir) => generateLegacy(dir),
    assert: (dir) => {
      const root = read(dir, 'AGENTS.md');
      if (!root) return ['AGENTS.md was not created'];
      const n = lineCount(root);
      return n <= 120 ? [] : [`root AGENTS.md has ${n} lines, budget is 120`];
    },
  },
  {
    id: 'monorepo-pnpm',
    fixture: 'monorepo-pnpm',
    prompt: 'Apply. Scopes: the root, packages/web and packages/api. Leave out packages/shared.',
    assert: (dir) => [
      ...mustExist(dir, ['AGENTS.md', 'packages/web/AGENTS.md', 'packages/api/AGENTS.md']),
      ...mustNotExist(dir, ['packages/shared/AGENTS.md']),
    ],
  },
  {
    id: 'monorepo-cargo',
    fixture: 'monorepo-cargo',
    prompt: 'Apply. Cover all scopes.',
    assert: (dir) => mustExist(dir, ['AGENTS.md', 'crates/cli/AGENTS.md', 'crates/core/AGENTS.md']),
  },
  {
    id: 'existing-claude-md',
    fixture: 'existing-claude-md',
    prompt: 'Apply. I approve moving the general content of CLAUDE.md into AGENTS.md. '
      + 'CLAUDE.md keeps only the Claude-specific content and imports AGENTS.md.',
    assert: (dir) => {
      const claude = read(dir, 'CLAUDE.md');
      return [
        ...mustContain(claude, 'KEEP-CLAUDE-SPECIFIC', 'CLAUDE.md'),
        ...mustContain(claude, '@AGENTS.md', 'CLAUDE.md'),
        ...mustContain(read(dir, 'AGENTS.md'), 'KEEP-GENERAL', 'AGENTS.md'),
        ...(claude.includes('KEEP-GENERAL') ? ['KEEP-GENERAL is still in CLAUDE.md after the approved move'] : []),
      ];
    },
  },
  {
    id: 'conflicting',
    fixture: 'conflicting-instructions',
    prompt: 'Apply.',
    assert: (dir, message) => {
      const both = `${read(dir, 'AGENTS.md')}\n${read(dir, 'CLAUDE.md')}`;
      return [
        ...mustExist(dir, ['docs/ai/ai-memory.md']), // proof the agent ran
        ...mustContain(both, 'CONFLICT-A', 'AGENTS.md and CLAUDE.md'),
        ...mustContain(both, 'CONFLICT-B', 'AGENTS.md and CLAUDE.md'),
        ...mustMention(message, /conflict/i, 'the conflict'),
      ];
    },
  },
  {
    id: 'published-docs',
    fixture: 'published-docs',
    prompt: 'Apply. docs/ is published, use internal/ai/ for the AI documents.',
    assert: (dir) => [
      ...mustNotExist(dir, ['docs/ai']),
      ...mustExist(dir, ['internal/ai/ai-memory.md']),
      ...mustContain(read(dir, 'AGENTS.md'), 'internal/ai', 'AGENTS.md'),
    ],
  },
  {
    id: 'published-docs-no-folder',
    fixture: 'published-docs',
    prompt: 'Apply.',
    assert: (dir, message) => [
      ...mustNotExist(dir, ['docs/ai', 'AGENTS.md', 'CLAUDE.md']),
      ...mustMention(message, /skip/i, 'the skipped documents'),
    ],
  },
  {
    id: 'update',
    fixture: 'app-ui',
    prompt: 'Update and apply.',
    // Runs after the skill is installed: a first run, then a change worth an update.
    setup: async (dir, ctx) => {
      const baseline = commitCount(dir);
      const first = ctx.runAgent('Apply.');
      if (first.error) throw new Error(`setup run failed: ${first.error}`);
      const problems = sharedAssertions(dir, { baseline });
      if (problems.length) throw new Error(`setup run broke a shared rule: ${problems.join('; ')}`);
      commitAll(dir, 'agent-ready first run');
      const pkgPath = join(dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      pkg.scripts.check = 'tsc --noEmit';
      await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      commitAll(dir, 'add check script');
    },
    assert: (dir) => {
      const text = read(dir, 'AGENTS.md');
      const stamp = stampCommit(text);
      const failures = [];
      if (!/\bcheck\b/.test(text)) failures.push('AGENTS.md does not mention check');
      if (!stamp) return [...failures, 'AGENTS.md has no stamp'];
      if (!head(dir).startsWith(stamp)) failures.push(`stamp commit ${stamp} is not the current HEAD`);
      if (head(dir, 'HEAD~1').startsWith(stamp)) failures.push('stamp commit is unchanged from before the update');
      return failures;
    },
  },
];
