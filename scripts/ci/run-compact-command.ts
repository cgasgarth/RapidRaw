#!/usr/bin/env bun
// @ts-check

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../lib/ci/compact-output.ts';

const args = process.argv.slice(2);
let label = 'command';
let cwd = process.cwd();
let commandStart = args.indexOf('--');

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
  console.error('Usage: run-compact-command.ts [--label name] [--cwd dir] -- command [...args]');
  process.exit(1);
}

const command = args.slice(commandStart + 1);
let proc;
try {
  proc = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
} catch (error) {
  console.error(`${label} failed`);
  console.error(`$ ${formatCommandForLog(command[0], command.slice(1))}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const stdout = readBoundedStream(proc.stdout);
const stderr = readBoundedStream(proc.stderr);
const exitCode = await proc.exited;

if (exitCode === 0) {
  console.log(`${label} ok`);
  process.exit(0);
}

console.error(`${label} failed`);
console.error(`$ ${formatCommandForLog(command[0], command.slice(1))}`);
const output = await stdout;
const errorOutput = await stderr;
writeBoundedOutput('stdout', output);
writeBoundedOutput('stderr', errorOutput);
process.exit(exitCode);
