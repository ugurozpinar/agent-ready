import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeRepo, ROOT, runValidate } from '../helpers.mjs';

const SKILL = join(ROOT, 'plugin/skills/agent-ready');
const STAMP = '<!-- agent-ready: v={{ar:version}} commit={{ar:commit}} -->';
const PACKAGES_RULE = 'Before working in a package, read its `AGENTS.md` (`packages/*/AGENTS.md`).';

const TEMPLATE_HEADINGS = {
  'agents-md': ['## Commands', '## Rules', '## Project docs (read when relevant)', '## Keep this file current'],
  'package-agents-md': ['## Commands', '## Rules', '## Docs'],
  'ai-memory': ['## How to use this file', '## Product and business context', '## Decisions', '## Constraints', '## Traps', '## Tried and rejected'],
  'voice-and-tone': ['Status:', '## Principles', '## Terminology', '## Do and don\'t', '## Languages', '## Open questions'],
  personas: ['Status:', '## Personas', '## Open questions'],
  'product-overview': ['Status:', '## What it is', '## Who it is for', '## What it is not', '## Core flows', '## Open questions'],
  'design-system': ['Status:', '## Sources of truth', '## Patterns', '## Rules', '## Open questions'],
};
const RULE_FILES = ['agents-md', 'ai-memory', 'voice-and-tone', 'personas', 'product-overview', 'design-system'];
const RULE_HEADINGS = ['## Purpose', '## Generate when', '## Evidence', '## Questions', '## Leave out', '## Good example'];
const DOCS = ['ai-memory', 'voice-and-tone', 'personas', 'product-overview', 'design-system'];

const SAMPLE = { status: 'draft', version: '0.1.0', commit: 'abc123', 'packages-rule': '' };
const render = (t, values = SAMPLE) => t.replaceAll(/\{\{ar:([a-z-]+)\}\}/g, (_, k) => values[k] ?? 'sample');

/** Files are checked out with CRLF on some Windows setups; the contract is about LF text. */
const read = (path) => readFileSync(join(SKILL, path), 'utf8').replaceAll('\r\n', '\n');
const template = (name) => read(`assets/templates/${name}.md`);
const ruleFile = (name) => read(`references/docs/${name}.md`);
const ids = (r) => r.json.errors.map((e) => e.check);

/** Lines outside fenced blocks: a fence holds examples, not the document's own structure. */
function linesOutsideFences(text) {
  let inFence = false;
  return text.split('\n').filter((line) => {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      return false;
    }
    return !inFence;
  });
}

const structureOf = (text) => linesOutsideFences(text)
  .filter((line) => /^## /.test(line) || /^Status:/.test(line))
  .map((line) => (line.startsWith('Status:') ? 'Status:' : line));

const lastNonEmptyLine = (text) => text.split('\n').filter((l) => l.trim()).at(-1);

const docFiles = (values = SAMPLE) => Object.fromEntries(
  DOCS.map((d) => [`docs/ai/${d}.md`, render(template(d), values)]),
);
const renderedSet = (values = SAMPLE) => ({
  'AGENTS.md': render(template('agents-md'), values),
  'CLAUDE.md': '@AGENTS.md\n',
  ...docFiles(values),
});

test('every template has its headings in order', () => {
  for (const [name, headings] of Object.entries(TEMPLATE_HEADINGS)) {
    assert.deepEqual(structureOf(template(name)), headings, name);
  }
  for (const name of ['agents-md', 'package-agents-md']) {
    assert.equal(lastNonEmptyLine(template(name)), STAMP, name);
  }
  assert.ok(template('package-agents-md').trimEnd().split('\n').length <= 30);
});

test('agents-md carries the spec index and upkeep text verbatim', () => {
  const text = template('agents-md');
  for (const line of [
    '- `docs/ai/ai-memory.md`: before architectural or product decisions. Add an entry\n'
      + '  when you learn something a senior developer new to the project would need and\n'
      + '  cannot get from the code, or when a major decision is made. Commit it with the\n'
      + '  related change.',
    '- `docs/ai/voice-and-tone.md`: before writing user-visible text.',
    '- `docs/ai/design-system.md`: before changing the interface.',
    '- `docs/ai/personas.md`: before designing features or flows for users.',
    '- `docs/ai/product-overview.md`: before product or scope decisions.',
    'If you change build, test, or lint commands, update this file in the same change.',
    '{{ar:packages-rule}}',
  ]) {
    assert.ok(text.includes(line), line);
  }
});

test('ai-memory carries its rules and entry format', () => {
  const text = template('ai-memory');
  for (const part of [
    '**Add:**', '**Do not add:**', '**Maintain:**', '**Commit:**',
    'Type: decision | constraint | trap | context | rejected',
    '### YYYY-MM-DD: Short title',
    'Why: ...',
    'Applies to: ...',
  ]) {
    assert.ok(text.includes(part), part);
  }
  assert.ok(!/EUR|invoice/i.test(text), 'the template must not carry a concrete fact');
  assert.ok(!text.includes('{{ar:'), 'the template has no markers');
});

test('every rule file has its headings', () => {
  for (const name of RULE_FILES) {
    const text = ruleFile(name);
    assert.deepEqual(structureOf(text), RULE_HEADINGS, name);
    assert.ok(text.includes('Unconfirmed statements make the document `draft`, and they are listed under `## Open questions`.'), `${name}: draft rule`);
    assert.ok(text.includes('`Status:` and `## Open questions` stay in English'), `${name}: English rule`);
    const example = text.slice(text.indexOf('## Good example'));
    assert.ok(example.includes('```'), `${name}: example is fenced`);
    assert.ok(!example.includes('{{ar:'), `${name}: example has no markers`);
  }
  assert.match(ruleFile('agents-md'), /[Rr]emove the index line/);
  assert.ok(ruleFile('agents-md').includes(PACKAGES_RULE));
  assert.match(ruleFile('voice-and-tone'), /examples use the product's language/i);
});

test('rendered set passes validate', async () => {
  const r = runValidate(await makeRepo(renderedSet()));
  assert.deepEqual(r.json.errors, []);
  assert.equal(r.code, 0);
});

test('confirmed status passes once open questions are removed', async () => {
  const confirmed = { ...SAMPLE, status: 'confirmed' };
  const files = renderedSet(confirmed);
  const kept = runValidate(await makeRepo(files));
  assert.ok(ids(kept).includes('open-questions'), 'validate must see the confirmed documents');

  for (const d of DOCS.filter((name) => name !== 'ai-memory')) {
    const path = `docs/ai/${d}.md`;
    files[path] = files[path].replace(/^## Open questions\n[\s\S]*$/m, '');
  }
  const r = runValidate(await makeRepo(files));
  assert.deepEqual(r.json.errors, []);
  assert.equal(r.code, 0);
});

test('unrendered template fails', async () => {
  for (const name of ['agents-md', 'voice-and-tone', 'personas', 'product-overview', 'design-system']) {
    const set = renderedSet();
    const path = name === 'agents-md' ? 'AGENTS.md' : `docs/ai/${name}.md`;
    set[path] = template(name);
    const r = runValidate(await makeRepo(set));
    assert.ok(ids(r).includes('template-marker'), name);
    assert.equal(r.code, 1, name);
  }
});

test('rendered package template passes in a monorepo', async () => {
  const files = {
    ...renderedSet({ ...SAMPLE, 'packages-rule': PACKAGES_RULE }),
    'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
    'packages/web/package.json': JSON.stringify({ name: 'web' }),
    'packages/web/AGENTS.md': render(template('package-agents-md')),
    'packages/web/CLAUDE.md': '@AGENTS.md\n',
  };
  const r = runValidate(await makeRepo(files));
  assert.deepEqual(r.json.errors, []);
  assert.equal(r.code, 0);

  const withoutRule = { ...files, 'AGENTS.md': render(template('agents-md')) };
  const uncovered = runValidate(await makeRepo(withoutRule));
  assert.ok(ids(uncovered).includes('package-coverage'), 'validate must see the package');
});
