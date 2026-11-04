const STAMP = /^<!-- agent-ready: v=(\S+) commit=(\S+) -->$/;

/** Reads the stamp from the last non-empty line of `text`. Null when absent or malformed. */
export function parseStamp(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = STAMP.exec(line);
    return m ? { version: m[1], commit: m[2] } : null;
  }
  return null;
}
