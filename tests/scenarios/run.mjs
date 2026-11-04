import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT } from '../helpers.mjs';
import {
  AGENTS, agentCommand, commitCount, evaluate, prepareWorkspace, preflight, runAgent,
} from './harness.mjs';
import { SCENARIOS } from './scenarios.mjs';

const USAGE = 'usage: node tests/scenarios/run.mjs [--agent claude|codex|all] [--scenario id] [--dry-run]';
const show = ({ bin, args }) => [bin, ...args].map((a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `'${a}'`)).join(' ');

function parse() {
  try {
    const { values } = parseArgs({
      options: { agent: { type: 'string', default: 'all' }, scenario: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
    });
    const agents = values.agent === 'all' ? AGENTS : [values.agent];
    if (agents.some((a) => !AGENTS.includes(a))) throw new Error(`unknown agent: ${values.agent}`);
    const scenarios = values.scenario ? SCENARIOS.filter((s) => s.id === values.scenario) : SCENARIOS;
    if (!scenarios.length) throw new Error(`unknown scenario: ${values.scenario}`);
    return { agents, scenarios, dryRun: values['dry-run'] };
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }
}

async function dryRun(agents, scenarios) {
  let prepared = false;
  for (const agent of agents) {
    for (const scenario of scenarios) {
      let dir = '<workspace>';
      if (!prepared) {
        prepared = true;
        // Free preparation only: a setup that needs the agent is skipped.
        dir = await prepareWorkspace(scenario.fixture, agent, {
          setup: scenario.setup,
          skipEvolve: true,
          install: process.env.AGENT_READY_SKIP_INSTALL_TEST !== '1',
        });
        console.log(`prepared ${scenario.id} for ${agent} at ${dir}`);
      }
      console.log(`[${agent}] ${scenario.id}: ${show(agentCommand(agent, dir, scenario.prompt))}`);
      if (dir !== '<workspace>') await rm(dir, { recursive: true, force: true });
    }
  }
  console.log('dry run: no agent was started');
}

async function runScenario(agent, scenario) {
  const started = Date.now();
  const result = { agent, id: scenario.id, status: 'failed', failures: [] };
  try {
    const dir = await prepareWorkspace(scenario.fixture, agent, { setup: scenario.setup });
    result.dir = dir;
    const baseline = commitCount(dir);
    const run = runAgent(agent, dir, scenario.prompt);
    result.finalMessage = run.finalMessage;
    result.stdout = run.stdout.slice(-20_000);
    result.stderr = run.stderr.slice(-5_000);
    if (run.error) result.failures.push(run.error);
    result.failures.push(...evaluate(scenario, dir, run.finalMessage, baseline));
    result.status = result.failures.length ? 'failed' : 'passed';
  } catch (error) {
    result.failures.push(`harness error: ${error.message}`);
  }
  result.seconds = Math.round((Date.now() - started) / 1000);
  return result;
}

async function main() {
  const { agents, scenarios, dryRun: dry } = parse();
  if (dry) return dryRun(agents, scenarios);

  const outDir = join(ROOT, 'tests/.results', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(outDir, { recursive: true });
  const results = [];
  for (const agent of agents) {
    const missing = preflight(agent);
    for (const scenario of scenarios) {
      const result = missing
        ? { agent, id: scenario.id, status: 'unavailable', failures: [missing] }
        : await runScenario(agent, scenario);
      results.push(result);
      await writeFile(join(outDir, `${agent}-${scenario.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
      console.log(`${result.status.toUpperCase().padEnd(11)} ${agent} ${scenario.id}`);
      for (const f of result.failures) console.log(`    - ${f}`);
    }
  }
  await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(results.map(({ agent, id, status }) => ({ agent, id, status })), null, 2)}\n`);
  const passed = results.filter((r) => r.status === 'passed').length;
  console.log(`${passed}/${results.length} passed. Results: ${outDir}`);
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(2);
});
