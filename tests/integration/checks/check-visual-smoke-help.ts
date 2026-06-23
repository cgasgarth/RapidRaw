#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';

const failures: string[] = [];

const help = run(['bun', 'scripts/capture-visual-smoke.ts', '--help']);
if (help.status !== 0) failures.push(`--help exited ${help.status ?? 'null'}`);
if (!help.stdout.includes('Usage: bun scripts/capture-visual-smoke.ts')) failures.push('--help missing usage line');
if (!help.stdout.includes('--list-scenarios')) failures.push('--help missing list-scenarios guidance');
if (help.stdout.includes('VITE') || help.stderr.includes('ZodError')) {
  failures.push('--help launched browser/server work or parsed proof reports');
}

const list = run(['bun', 'scripts/capture-visual-smoke.ts', '--list-scenarios']);
if (list.status !== 0) failures.push(`--list-scenarios exited ${list.status ?? 'null'}`);
for (const scenario of ['empty-library', 'tether-discovery-ui', 'sr-private-raw-ui']) {
  if (!list.stdout.includes(scenario)) failures.push(`--list-scenarios missing ${scenario}`);
}
if (list.stdout.includes('VITE') || list.stderr.includes('ZodError')) {
  failures.push('--list-scenarios launched browser/server work or parsed proof reports');
}

if (failures.length > 0) {
  console.error('visual smoke help check failed');
  console.error(failures.slice(0, 8).join('\n'));
  process.exit(1);
}

console.log('visual smoke help ok');

function run(command: string[]) {
  return spawnSync(command[0] ?? '', command.slice(1), {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
}
