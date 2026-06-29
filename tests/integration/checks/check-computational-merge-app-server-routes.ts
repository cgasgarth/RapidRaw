#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { COMPUTATIONAL_MERGE_APP_SERVER_ROUTES } from '../../../src/utils/computationalMergeAppServerRoutes.ts';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageScripts = new Set(Object.keys(packageJson.scripts ?? {}));
const failures = [];
const runtimeCheckScripts = [
  'check:hdr-app-server-runtime',
  'check:focus-app-server-runtime',
  'check:panorama-app-server-runtime',
  'check:sr-app-server-runtime',
];

for (const route of COMPUTATIONAL_MERGE_APP_SERVER_ROUTES) {
  if (!packageScripts.has(route.runtimeCheckScript)) {
    failures.push(`${route.toolName} references missing runtime check ${route.runtimeCheckScript}.`);
  }
}

for (const runtimeCheckScript of runtimeCheckScripts) {
  runPackageScript(runtimeCheckScript);
}

for (const route of COMPUTATIONAL_MERGE_APP_SERVER_ROUTES) {
  if (!runtimeCheckScripts.includes(route.runtimeCheckScript)) {
    failures.push(`${route.toolName} is not covered by a vertical runtime check.`);
  }
}

if (failures.length > 0) {
  console.error('Computational merge app-server route validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`computational merge app-server routes ok (${COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.length})`);

function runPackageScript(scriptName: string): void {
  const result = Bun.spawnSync(['bun', 'run', scriptName], {
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
