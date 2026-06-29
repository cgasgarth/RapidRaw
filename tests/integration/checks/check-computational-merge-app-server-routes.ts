#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { COMPUTATIONAL_MERGE_APP_SERVER_ROUTES } from '../../../src/utils/computationalMergeAppServerRoutes.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageScripts = new Set(Object.keys(packageJson.scripts ?? {}));
const routeToolNames = new Set(COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.map((route) => route.toolName));
const failures = [];

for (const tool of sampleComputationalMergeAppServerToolManifestV1.tools) {
  if (!routeToolNames.has(tool.toolName)) {
    failures.push(`${tool.toolName} is missing from computational merge app-server route manifest.`);
  }
}

for (const route of COMPUTATIONAL_MERGE_APP_SERVER_ROUTES) {
  const tool = sampleComputationalMergeAppServerToolManifestV1.tools.find(
    (candidate) => candidate.toolName === route.toolName,
  );
  if (tool === undefined) {
    failures.push(`${route.toolName} does not exist in the schema app-server tool manifest.`);
    continue;
  }

  if (!tool.allowedCommandTypes.includes(route.commandType)) {
    failures.push(`${route.toolName} does not allow route command type ${route.commandType}.`);
  }

  if (tool.executionMode !== route.executionMode) {
    failures.push(`${route.toolName} route execution mode does not match schema manifest.`);
  }

  if (tool.inputSchemaName !== route.inputSchemaName || tool.outputSchemaName !== route.outputSchemaName) {
    failures.push(`${route.toolName} route schemas do not match schema manifest.`);
  }

  if (!packageScripts.has(route.runtimeCheckScript)) {
    failures.push(`${route.toolName} references missing runtime check ${route.runtimeCheckScript}.`);
  }
}

for (const family of ['focus_stack', 'hdr', 'panorama', 'super_resolution']) {
  for (const executionMode of ['apply_dry_run_plan', 'dry_run_command', 'open_derived_source']) {
    const hasRoute = COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.some(
      (route) => route.family === family && route.executionMode === executionMode,
    );
    if (!hasRoute) {
      failures.push(`${family} is missing ${executionMode} app-server route coverage.`);
    }
  }
}

for (const marker of [
  'COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST',
  'computationalMergeAppServerRouteManifestSchema',
  'check-computational-merge-app-server-routes',
]) {
  const source = `${readFileSync('src/utils/computationalMergeAppServerRoutes.ts', 'utf8')}\n${readFileSync(
    'src/schemas/computationalMergeAppServerSchemas.ts',
    'utf8',
  )}\n${readFileSync('package.json', 'utf8')}`;
  if (!source.includes(marker)) failures.push(`Missing marker ${marker}.`);
}

if (failures.length > 0) {
  console.error('Computational merge app-server route validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`computational merge app-server routes ok (${COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.length})`);
