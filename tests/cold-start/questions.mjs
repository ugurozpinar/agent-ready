// Prompts here pass through cmd.exe on Windows: no double quotes, percent signs, or newlines.
export const FACTS = "Invoices stay in EUR only because finance reconciliation is EUR-only until 2027. User-facing copy never uses the word 'simply'.";

export const QUESTION_SUFFIX = 'Answer in one line. Do not edit files.';

export const QUESTIONS = [
  { id: 'test-command', question: 'Which command runs the tests in this repository?', expected: /npm test/, inCode: true },
  { id: 'lint-command', question: 'Which command runs the linter in this repository?', expected: /npm run lint/, inCode: true },
  { id: 'design-tokens', question: 'Where are the design tokens defined in this repository?', expected: /tailwind\.config/, inCode: true },
  { id: 'currency', question: 'In which currency must invoices be issued in this repository?', expected: /EUR/, inCode: false },
  { id: 'banned-word', question: 'Which word must never appear in user-facing copy in this repository?', expected: /simply/i, inCode: false },
];

/**
 * results: {id, with, without}[] where each flag says whether that session answered correctly.
 * Passes when the generated files do at least as well as the plain repository and every
 * question whose answer is not in the code was answered with the files.
 */
export function score(results) {
  const byId = new Map(results.map((r) => [r.id, r]));
  const withCorrect = results.filter((r) => r.with).length;
  const withoutCorrect = results.filter((r) => r.without).length;
  const nonCodeMissed = QUESTIONS.filter((q) => !q.inCode && !byId.get(q.id)?.with).map((q) => q.id);
  return { withCorrect, withoutCorrect, nonCodeMissed, passed: withCorrect >= withoutCorrect && nonCodeMissed.length === 0 };
}

const sumUsage = (u) => Object.values(u).filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0);

/**
 * Total tokens from Claude's JSON `usage` or Codex's `--json` usage events; null when absent.
 * Codex reports cached input as part of input, so it is not added twice.
 */
export function tokenUsage(agent, stdout) {
  if (agent === 'claude') {
    try {
      const parsed = JSON.parse(stdout);
      const last = Array.isArray(parsed) ? parsed.findLast((e) => e?.type === 'result') : parsed;
      return last?.usage && typeof last.usage === 'object' ? sumUsage(last.usage) : null;
    } catch {
      return null;
    }
  }
  let total = null;
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const usage = JSON.parse(line)?.usage;
      if (usage && typeof usage === 'object') {
        total = (total ?? 0) + (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
      }
    } catch {
      // not a JSON line
    }
  }
  return total;
}
