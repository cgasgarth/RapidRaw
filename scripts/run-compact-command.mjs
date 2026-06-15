#!/usr/bin/env bun

const args = process.argv.slice(2);
const MAX_FAILURE_CHARS = 100_000;
const MAX_FAILURE_LINES = 240;
const HEAD_LINES = 80;
const TAIL_LINES = 140;
let label = 'command';
let cwd = process.cwd();
let commandStart = args.indexOf('--');

const writeBounded = (name, value) => {
  if (!value) return;

  const normalized = value.endsWith('\n') ? value : `${value}\n`;
  const lines = normalized.split(/\r?\n/u);
  const tooManyChars = normalized.length > MAX_FAILURE_CHARS;
  const tooManyLines = lines.length > MAX_FAILURE_LINES;

  if (!tooManyChars && !tooManyLines) {
    process.stderr.write(normalized);
    return;
  }

  console.error(`${name} truncated (${lines.length} lines, ${normalized.length} chars)`);

  if (tooManyLines) {
    const head = lines.slice(0, HEAD_LINES).join('\n');
    const tail = lines.slice(-TAIL_LINES).join('\n');
    if (head) process.stderr.write(`${head}\n`);
    console.error('[...]');
    if (tail) process.stderr.write(`${tail}\n`);
    return;
  }

  process.stderr.write(normalized.slice(0, 60_000));
  console.error('\n[...]');
  process.stderr.write(normalized.slice(-40_000));
};

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--') {
    commandStart = index;
    break;
  }

  if (args[index] === '--label') {
    const value = args[index + 1];
    if (!value) {
      console.error('Missing value for --label');
      process.exit(1);
    }

    label = value;
    index += 1;
    continue;
  }

  if (args[index] === '--cwd') {
    const value = args[index + 1];
    if (!value) {
      console.error('Missing value for --cwd');
      process.exit(1);
    }

    cwd = value;
    index += 1;
  }
}

if (commandStart < 0 || commandStart === args.length - 1) {
  console.error('Usage: run-compact-command.mjs [--label name] [--cwd dir] -- command [...args]');
  process.exit(1);
}

const command = args.slice(commandStart + 1);
const proc = Bun.spawn(command, {
  cwd,
  stdout: 'pipe',
  stderr: 'pipe',
});

const output = await new Response(proc.stdout).text();
const errorOutput = await new Response(proc.stderr).text();
const exitCode = await proc.exited;

if (exitCode === 0) {
  console.log(`${label} ok`);
  process.exit(0);
}

console.error(`${label} failed`);
console.error(`$ ${command.join(' ')}`);
writeBounded('stdout', output);
writeBounded('stderr', errorOutput);
process.exit(exitCode);
