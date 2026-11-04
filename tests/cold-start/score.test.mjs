import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FACTS, QUESTIONS, assertNoErrors, score, sessionError, tokenUsage } from './questions.mjs';

// Builds results where the first `withN` / `withoutN` questions are answered correctly.
const results = (withN, withoutN, { missWith = [] } = {}) => QUESTIONS.map((q, i) => ({
  id: q.id,
  with: i < withN && !missWith.includes(q.id),
  without: i < withoutN,
}));

test('passes when equal and non-code answered', () => {
  const r = score(results(5, 3));
  assert.deepEqual(r, { withCorrect: 5, withoutCorrect: 3, nonCodeMissed: [], passed: true });
  assert.equal(score(results(5, 5)).passed, true);
});

test('fails when worse than baseline', () => {
  const r = score(results(3, 4));
  assert.equal(r.withCorrect, 3);
  assert.equal(r.withoutCorrect, 4);
  assert.equal(r.passed, false);
});

test('fails when a non-code question is missed', () => {
  const r = score(results(5, 2, { missWith: ['currency'] }));
  assert.equal(r.withCorrect, 4);
  assert.equal(r.withoutCorrect, 2);
  assert.deepEqual(r.nonCodeMissed, ['currency']);
  assert.equal(r.passed, false);
});

test('pinned questions and facts', () => {
  assert.equal(QUESTIONS.length, 5);
  assert.deepEqual(QUESTIONS.filter((q) => !q.inCode).map((q) => q.id), ['currency', 'banned-word']);
  assert.match('Run npm test', QUESTIONS[0].expected);
  assert.match('EUR', QUESTIONS.find((q) => q.id === 'currency').expected);
  assert.match('Never use Simply', QUESTIONS.find((q) => q.id === 'banned-word').expected);
  assert.match(FACTS, /EUR-only until 2027/);
});

test('every prompt passes the cmd.exe guard', () => {
  for (const text of [FACTS, ...QUESTIONS.map((q) => q.question)]) assert.doesNotMatch(text, /["%\r\n]/);
});

test('tokenUsage reads claude JSON and codex JSONL, null when absent', () => {
  const claude = JSON.stringify({ type: 'result', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 } });
  assert.equal(tokenUsage('claude', claude), 115);
  const codex = [
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 7, cached_input_tokens: 3, output_tokens: 2 } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 4, output_tokens: 1 } }),
  ].join('\n');
  assert.equal(tokenUsage('codex', codex), 14);
  assert.equal(tokenUsage('claude', 'not json'), null);
  assert.equal(tokenUsage('claude', JSON.stringify({ type: 'result' })), null);
  assert.equal(tokenUsage('codex', ''), null);
});

test('run.mjs --dry-run prints the plan and spawns no agent', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const run = fileURLToPath(new URL('./run.mjs', import.meta.url));
  for (const agent of ['claude', 'codex']) {
    // Binaries that cannot exist: any attempt to start an agent would show up as a failure.
    const env = { ...process.env, CLAUDE_BIN: 'no-such-claude-bin', CODEX_BIN: 'no-such-codex-bin' };
    const r = spawnSync(process.execPath, [run, '--agent', agent, '--dry-run'], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /dry run: no agent was started/);
    assert.match(r.stdout, new RegExp(`no-such-${agent}-bin`));
    assert.match(r.stdout, /Answer in one line\. Do not edit files\./);
    assert.doesNotMatch(r.stdout, /agent-ready Which/);
    assert.equal(r.stdout.split('\n').filter((l) => l.includes('(with files)')).length, QUESTIONS.length);
  }
  const bad = spawnSync(process.execPath, [run, '--agent', 'nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

test('errored sessions fail the run instead of scoring as wrong', () => {
  assertNoErrors([{ id: 'currency', errors: [] }]);
  assert.throws(() => assertNoErrors([{ id: 'currency', errors: ['agent exited 1'] }]), /currency: agent exited 1/);
});

test('sessionError reports spawn errors, exit codes and claude is_error', () => {
  const ok = JSON.stringify({ type: 'result', result: 'x' });
  assert.equal(sessionError('claude', { status: 0, stdout: ok }), null);
  assert.match(sessionError('claude', { error: new Error('boom'), status: null, stdout: '' }), /boom/);
  assert.match(sessionError('codex', { status: 3, stdout: '' }), /exited 3/);
  const bad = JSON.stringify({ type: 'result', is_error: true, result: 'rate limited' });
  assert.match(sessionError('claude', { status: 0, stdout: bad }), /is_error: rate limited/);
});

test('question sessions are read-only with no duplicated flags', () => {
  const run = fileURLToPath(new URL('./run.mjs', import.meta.url));
  const out = (agent) => spawnSync(process.execPath, [run, '--agent', agent, '--dry-run'], { encoding: 'utf8' }).stdout;
  const questions = (text) => text.split(/\r?\n/).filter((l) => /\((with files|baseline)\)/.test(l));
  const claude = questions(out('claude'));
  assert.equal(claude.length, 10);
  for (const l of claude) {
    assert.equal(l.match(/--permission-mode/g).length, 1);
    assert.match(l, /--permission-mode plan/);
    assert.doesNotMatch(l, /acceptEdits/);
  }
  const codex = questions(out('codex'));
  for (const l of codex) {
    assert.equal(l.match(/ -s /g).length, 1);
    assert.match(l, / -s read-only /);
    assert.doesNotMatch(l, /workspace-write/);
  }
  assert.match(out('claude'), /acceptEdits/); // the generation run still may edit
});
