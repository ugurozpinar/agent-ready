import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, copyFixture } from '../helpers.mjs';
import {
  AGENTS, agentCommand, buildSpawn, finalMessage, prepareWorkspace, preflight, resolveBin, runAgent,
} from '../scenarios/harness.mjs';
import { FACTS, QUESTIONS, QUESTION_SUFFIX, score, tokenUsage } from './questions.mjs';

const USAGE = 'usage: node tests/cold-start/run.mjs [--agent claude|codex] [--dry-run]';
const GENERATE_PROMPT = `Generate the agent files for this repository. Record these facts: ${FACTS}`;
const SKILL_PARENTS = ['.claude/skills', '.agents/skills'];
const show = ({ bin, args }) => [bin, ...args].map((a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `'${a}'`)).join(' ');

/** A question session: the agent command with the skill invocation swapped for the question. */
function questionCommand(agent, dir, question) {
  const cmd = agentCommand(agent, dir, '');
  // The skill invocation is the prompt argument: after -p for claude, the last argument for codex.
  const index = agent === 'claude' ? cmd.args.indexOf('-p') + 1 : cmd.args.length - 1;
  cmd.args[index] = `${question} ${QUESTION_SUFFIX}`;
  return cmd;
}

function ask(agent, dir, question) {
  const { bin, args } = questionCommand(agent, dir, question);
  const plan = buildSpawn(resolveBin(bin), args);
  const r = spawnSync(plan.file, plan.args, {
    ...plan.options, cwd: dir, timeout: 5 * 60 * 1000, env: process.env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  const stdout = r.stdout ?? '';
  const error = r.error ? r.error.message : r.status !== 0 ? `agent exited ${r.status}` : null;
  return { error, answer: finalMessage(agent, stdout), tokens: tokenUsage(agent, stdout) };
}

async function removeSkills(dir) {
  for (const rel of SKILL_PARENTS) await rm(join(dir, rel), { recursive: true, force: true });
}

const sumTokens = (list) => (list.every((t) => t === null) ? null : list.reduce((a, t) => a + (t ?? 0), 0));

async function runColdStart(agent) {
  let withDir;
  let plainDir;
  try {
    withDir = await prepareWorkspace('app-ui', agent);
    const gen = runAgent(agent, withDir, GENERATE_PROMPT);
    if (gen.error) throw new Error(`generation run failed: ${gen.error}`);
    await removeSkills(withDir); // question sessions must not see the skill or its examples
    plainDir = await copyFixture('app-ui');
    const rows = [];
    for (const q of QUESTIONS) {
      const w = ask(agent, withDir, q.question);
      const p = ask(agent, plainDir, q.question);
      rows.push({
        id: q.id,
        with: !w.error && q.expected.test(w.answer),
        without: !p.error && q.expected.test(p.answer),
        withAnswer: w.answer,
        withoutAnswer: p.answer,
        errors: [w.error, p.error].filter(Boolean),
        withTokens: w.tokens,
        withoutTokens: p.tokens,
      });
    }
    return {
      agent,
      ...score(rows),
      rows,
      generationTokens: tokenUsage(agent, gen.stdout),
      withTokens: sumTokens(rows.map((r) => r.withTokens)),
      withoutTokens: sumTokens(rows.map((r) => r.withoutTokens)),
    };
  } finally {
    for (const dir of [withDir, plainDir]) if (dir) await rm(dir, { recursive: true, force: true });
  }
}

function dryRun(agent) {
  console.log(`[${agent}] generate on app-ui (skill installed): ${show(agentCommand(agent, '<workspace>', GENERATE_PROMPT))}`);
  console.log(`[${agent}] then remove ${SKILL_PARENTS.join(' and ')} from the workspace`);
  for (const q of QUESTIONS) {
    console.log(`[${agent}] ${q.id} (with files): ${show(questionCommand(agent, '<generated workspace>', q.question))}`);
    console.log(`[${agent}] ${q.id} (baseline):   ${show(questionCommand(agent, '<plain fixture>', q.question))}`);
  }
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: { agent: { type: 'string', default: 'claude' }, 'dry-run': { type: 'boolean', default: false } } }));
    if (!AGENTS.includes(values.agent)) throw new Error(`unknown agent: ${values.agent}`);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }
  const agent = values.agent;
  if (values['dry-run']) {
    dryRun(agent);
    console.log('dry run: no agent was started');
    return;
  }
  const missing = preflight(agent);
  if (missing) {
    console.error(missing);
    process.exit(2);
  }
  const result = await runColdStart(agent);
  const outDir = join(ROOT, 'tests/.results');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, `cold-start-${agent}-${Date.now()}.json`), `${JSON.stringify(result, null, 2)}\n`);
  const { rows, ...summary } = result;
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = result.passed ? 0 : 1;
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(2);
});
