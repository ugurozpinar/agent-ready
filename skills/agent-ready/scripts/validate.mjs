#!/usr/bin/env node
import { parseCliArgs } from './lib/cli.mjs';
import { collectScopes, runCoreChecks } from './lib/checks-core.mjs';
import { listFiles } from './lib/files.mjs';

const USAGE = 'usage: validate.mjs <root> [--scope <path>] [--skip-claude-bridge]';

const { root, scopePath, flags } = parseCliArgs(process.argv.slice(2), { usage: USAGE, flags: ['--skip-claude-bridge'] });

function main() {
  const { files } = listFiles(root);
  const scopes = collectScopes(root, scopePath, files);
  const core = runCoreChecks({ root, scopes, skipClaudeBridge: flags.has('--skip-claude-bridge'), files });
  const out = { schemaVersion: 1, errors: core.errors, warnings: core.warnings };
  process.stdout.write(JSON.stringify(out));
  process.exitCode = out.errors.length > 0 ? 1 : 0;
}

try {
  main();
} catch (e) {
  process.stderr.write(`validate failed: ${e && e.message ? e.message : e}\n`);
  process.exit(2);
}
