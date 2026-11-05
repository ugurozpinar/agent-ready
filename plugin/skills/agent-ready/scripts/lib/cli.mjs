import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Parses `<root> [--scope <path>]` plus the given boolean flags. Exits 2 with the usage line on bad input.
 * Returns `{root, scopePath, flags}`; `scopePath` is root-relative with forward slashes, `.` for the root, or null.
 */
export function parseCliArgs(argv, { usage, flags = [] }) {
  const fail = (message) => {
    process.stderr.write(`${message}\n${usage}\n`);
    process.exit(2);
  };
  const positional = [];
  const set = new Set();
  let scope = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--scope') {
      i++;
      if (i >= argv.length || argv[i].startsWith('-')) fail('--scope needs a path');
      scope = argv[i];
    } else if (flags.includes(arg)) {
      set.add(arg);
    } else if (arg.startsWith('-')) {
      fail(`unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) fail('expected exactly one root path');
  const root = resolve(positional[0]);
  if (!isDirectory(root)) fail(`not a directory: ${positional[0]}`);
  let scopePath = null;
  if (scope !== null) {
    const abs = resolve(root, scope.replaceAll('\\', '/'));
    const rel = relative(root, abs);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`scope is outside the root: ${scope}`);
    if (!isDirectory(abs)) fail(`scope is not a directory: ${scope}`);
    scopePath = rel.split(sep).join('/') || '.';
  }
  return { root, scopePath, flags: set };
}
