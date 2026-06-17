const readPositiveInt = (name, fallback) => {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const DEFAULT_MAX_FAILURE_CHARS = readPositiveInt('RAWENGINE_COMPACT_MAX_CHARS', 4_000);
const DEFAULT_MAX_FAILURE_LINES = readPositiveInt('RAWENGINE_COMPACT_MAX_LINES', 24);
const DEFAULT_HEAD_LINES = readPositiveInt('RAWENGINE_COMPACT_HEAD_LINES', 8);
const DEFAULT_TAIL_LINES = readPositiveInt('RAWENGINE_COMPACT_TAIL_LINES', 12);

export const formatCommandForLog = (command, args = [], { maxArgs = 10, maxChars = 240 } = {}) => {
  const parts = [command, ...args].filter(Boolean);
  const visibleParts = parts.length > maxArgs ? [...parts.slice(0, maxArgs), `...(+${parts.length - maxArgs})`] : parts;
  const rendered = visibleParts.join(' ');

  if (rendered.length <= maxChars) {
    return rendered;
  }

  return `${rendered.slice(0, maxChars)}...`;
};

export const readBoundedStream = async (stream, { maxChars = DEFAULT_MAX_FAILURE_CHARS * 2 } = {}) => {
  if (!stream) return '';

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const headLimit = Math.ceil(maxChars * 0.55);
  const tailLimit = Math.floor(maxChars * 0.45);
  let full = '';
  let head = '';
  let tail = '';
  let totalChars = 0;
  let truncated = false;

  const append = (chunk) => {
    if (!chunk) return;

    totalChars += chunk.length;
    if (!truncated && full.length + chunk.length <= maxChars) {
      full += chunk;
      return;
    }

    if (!truncated) {
      truncated = true;
      head = full.slice(0, headLimit);
      tail = full.slice(-tailLimit);
      full = '';
    }

    tail = `${tail}${chunk}`.slice(-tailLimit);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    append(decoder.decode(value, { stream: true }));
  }
  append(decoder.decode());

  if (!truncated) {
    return full;
  }

  return `${head}\n[stream truncated (${totalChars} chars, kept ${maxChars})]\n${tail}`;
};

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
