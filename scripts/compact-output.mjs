const DEFAULT_MAX_FAILURE_CHARS = 16_000;
const DEFAULT_MAX_FAILURE_LINES = 80;
const DEFAULT_HEAD_LINES = 25;
const DEFAULT_TAIL_LINES = 45;

export const writeBoundedOutput = (
  name,
  value,
  {
    maxChars = DEFAULT_MAX_FAILURE_CHARS,
    maxLines = DEFAULT_MAX_FAILURE_LINES,
    headLines = DEFAULT_HEAD_LINES,
    tailLines = DEFAULT_TAIL_LINES,
  } = {},
) => {
  if (!value) return;

  const normalized = value.endsWith('\n') ? value : `${value}\n`;
  const lines = normalized.split(/\r?\n/u);
  const tooManyChars = normalized.length > maxChars;
  const tooManyLines = lines.length > maxLines;

  if (!tooManyChars && !tooManyLines) {
    process.stderr.write(normalized);
    return;
  }

  console.error(`${name} truncated (${lines.length} lines, ${normalized.length} chars)`);

  if (tooManyLines) {
    const head = lines.slice(0, headLines).join('\n');
    const tail = lines.slice(-tailLines).join('\n');
    if (head) process.stderr.write(`${head}\n`);
    console.error('[...]');
    if (tail) process.stderr.write(`${tail}\n`);
    return;
  }

  const headChars = Math.ceil(maxChars * 0.55);
  const tailChars = Math.floor(maxChars * 0.45);
  process.stderr.write(normalized.slice(0, headChars));
  console.error('\n[...]');
  process.stderr.write(normalized.slice(-tailChars));
};
