#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { RawEngineAppServerRouteMode } from '../../../src/schemas/agentRuntimeSchemas.ts';
import { AGENT_LOCAL_LAYER_COVERAGE_MATRIX } from '../../../src/utils/agentLocalLayerCoverageMatrix.ts';
import { buildRawEngineAppServerRouteCatalog } from '../../../src/utils/rawEngineAppServerHost.ts';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> };
const scripts = packageJson.scripts ?? {};
const routes = buildRawEngineAppServerRouteCatalog();
const failures: string[] = [];
const seenTools = new Set<string>();

for (const entry of AGENT_LOCAL_LAYER_COVERAGE_MATRIX) {
  if (seenTools.has(entry.toolName)) failures.push(`${entry.toolName}: duplicate matrix entry`);
  seenTools.add(entry.toolName);

  const route = routes.find((candidate) => candidate.commandName === entry.toolName);
  if (route === undefined) {
    failures.push(`${entry.toolName}: missing app-server route`);
    continue;
  }
  if (route.family !== 'agent') failures.push(`${entry.toolName}: route family is ${route.family}`);
  if (!route.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan)) {
    failures.push(`${entry.toolName}: route missing apply_dry_run_plan mode`);
  }
  if (!route.inputSchemaNames.includes(entry.inputSchemaName)) {
    failures.push(`${entry.toolName}: route missing input schema ${entry.inputSchemaName}`);
  }
  if (!route.outputSchemaNames.includes(entry.outputSchemaName)) {
    failures.push(`${entry.toolName}: route missing output schema ${entry.outputSchemaName}`);
  }
  if (!route.runtimeCheckScripts.includes(entry.runtimeCheckScript)) {
    failures.push(`${entry.toolName}: route missing runtime check ${entry.runtimeCheckScript}`);
  }
  if (scripts[entry.runtimeCheckScript] === undefined) {
    failures.push(`${entry.toolName}: package script ${entry.runtimeCheckScript} is missing`);
  }
  if (entry.commandTypes.length === 0) failures.push(`${entry.toolName}: missing typed command type coverage`);
  if (entry.receiptFields.length < 4) failures.push(`${entry.toolName}: receipt field coverage is too weak`);
  if (!entry.rollbackProof.includes('undoGraphRevision')) {
    failures.push(`${entry.toolName}: rollback proof must include undoGraphRevision`);
  }
  if (!entry.previewProof.includes('beforePreviewHash') || !entry.previewProof.includes('afterPreviewHash')) {
    failures.push(`${entry.toolName}: preview proof must include before/after preview hashes`);
  }
  if (!entry.previewProof.some((field) => field.startsWith('overlayPreview.'))) {
    failures.push(`${entry.toolName}: local layer/mask coverage must include overlayPreview proof`);
  }
}

if (AGENT_LOCAL_LAYER_COVERAGE_MATRIX.some((entry) => entry.status !== 'covered')) {
  failures.push('coverage matrix should not include partial local layer tool entries');
}

if (failures.length > 0) {
  console.error(`agent local/layer coverage matrix failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`agent local/layer coverage matrix ok (${AGENT_LOCAL_LAYER_COVERAGE_MATRIX.length} surfaces)`);
