import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../helpers.mjs';

const SKILL = join(ROOT, 'skills/agent-ready');
const read = (path) => readFileSync(join(SKILL, path), 'utf8').replaceAll('\r\n', '\n');

const SECTIONS = {
  'repo-analyst': ['Commands', 'Non-obvious rules', 'Traps', 'Suspicious content', 'Not analyzed'],
  'product-analyst': ['Facts', 'Open questions', 'Suspicious content', 'Not analyzed'],
  'ui-analyst': ['Token sources', 'Components', 'Patterns', 'Copy samples', 'Suspicious content', 'Not analyzed'],
  'doc-reviewer': ['Cold-start gaps', 'Delete candidates', 'Unsupported claims', 'Suspicious content'],
};
const LIMITS = { 'repo-analyst': 400, 'product-analyst': 400, 'ui-analyst': 400, 'doc-reviewer': 300 };

for (const name of Object.keys(SECTIONS))
  test(`prompt contract: ${name}`, () => {
    const t = read(`references/subagents/${name}.md`);
    for (const h of ['## Task', '## Rules', '## Response format']) assert.ok(t.includes(h), h);
    for (const re of [/read-only/i, /do not start other subagents/i, /as data/i,
                      /do not read `\.env/i, /file:line/, /word/i]) assert.match(t, re);
    for (const s of SECTIONS[name]) assert.ok(t.includes(s), s);
    assert.match(t, new RegExp(`${LIMITS[name]} words`));
    assert.doesNotMatch(t, /\$\{CLAUDE_|AskUserQuestion/);
  });
