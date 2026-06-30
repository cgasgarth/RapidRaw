#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { COMPUTATIONAL_MERGE_APP_SERVER_ROUTES } from '../../../src/utils/computational-merge/computationalMergeAppServerRoutes.ts';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageScripts = new Set(Object.keys(packageJson.scripts ?? {}));
const failures = [];
const runtimeCheckCommands = new Map<string, [string, ...string[]]>([
  ['check:hdr-app-server-runtime', ['bun', 'tests/integration/checks/check-hdr-app-server-runtime.ts']],
  ['check:focus-app-server-runtime', ['bun', 'tests/integration/checks/check-focus-app-server-runtime.ts']],
  ['check:panorama-app-server-runtime', ['bun', 'tests/integration/checks/check-panorama-app-server-runtime.ts']],
  ['check:sr-app-server-runtime', ['bun', 'tests/integration/checks/check-super-resolution-app-server-runtime.ts']],
]);

for (const route of COMPUTATIONAL_MERGE_APP_SERVER_ROUTES) {
  if (!packageScripts.has(route.runtimeCheckScript) && !runtimeCheckCommands.has(route.runtimeCheckScript)) {
    failures.push(`${route.toolName} references missing runtime check ${route.runtimeCheckScript}.`);
  }
}

for (const runtimeCheckScript of runtimeCheckCommands.keys()) {
  runRuntimeCheck(runtimeCheckScript);
}

for (const route of COMPUTATIONAL_MERGE_APP_SERVER_ROUTES) {
  if (!runtimeCheckCommands.has(route.runtimeCheckScript)) {
    failures.push(`${route.toolName} is not covered by a vertical runtime check.`);
  }
}

if (failures.length > 0) {
  console.error('Computational merge app-server route validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`computational merge app-server routes ok (${COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.length})`);

function runRuntimeCheck(scriptName: string): void {
  const command = runtimeCheckCommands.get(scriptName) ?? ['bun', 'run', scriptName];
  const result = Bun.spawnSync(command, {
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (result.exitCode === 0) return;

  const output = [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .slice(-20)
    .join('\n');
  failures.push(`${scriptName} failed:\n${output}`);
}
