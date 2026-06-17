#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import {
  RAW_ENGINE_APP_SERVER_HOST_MANIFEST,
  buildRawEngineAppServerCapabilitiesReplay,
  buildRawEngineAppServerHealthReplay,
  buildRawEngineAppServerRouteCatalogReplay,
} from '../src/utils/rawEngineAppServerHost.ts';
import {
  rawEngineAppServerCapabilitiesReplaySchema,
  rawEngineAppServerHealthReplaySchema,
  rawEngineAppServerHostManifestSchema,
  rawEngineAppServerRouteCatalogReplaySchema,
} from '../src/schemas/agentRuntimeSchemas.ts';

const failures = [];
const manifest = rawEngineAppServerHostManifestSchema.parse(RAW_ENGINE_APP_SERVER_HOST_MANIFEST);
const healthTool = manifest.tools.find((tool) => tool.toolName === 'rawengine.host.health');
const capabilitiesTool = manifest.tools.find((tool) => tool.toolName === 'rawengine.host.capabilities');
const routeCatalogTool = manifest.tools.find((tool) => tool.toolName === 'rawengine.host.route_catalog');

if (healthTool === undefined) {
  failures.push('Missing rawengine.host.health tool.');
} else {
  if (healthTool.mutates) failures.push('Health tool must be read-only.');
  if (healthTool.toolKind !== 'read') failures.push('Health tool must use read kind.');
}

if (capabilitiesTool === undefined) {
  failures.push('Missing rawengine.host.capabilities tool.');
} else {
  if (capabilitiesTool.mutates) failures.push('Capabilities tool must be read-only.');
  if (capabilitiesTool.toolKind !== 'read') failures.push('Capabilities tool must use read kind.');
}

if (routeCatalogTool === undefined) {
  failures.push('Missing rawengine.host.route_catalog tool.');
} else {
  if (routeCatalogTool.mutates) failures.push('Route catalog tool must be read-only.');
  if (routeCatalogTool.toolKind !== 'read') failures.push('Route catalog tool must use read kind.');
}

const replay = rawEngineAppServerHealthReplaySchema.parse(
  buildRawEngineAppServerHealthReplay({
    requestId: 'health_replay_001',
    toolName: 'rawengine.host.health',
  }),
);

if (replay.response.status !== 'ok') failures.push('Health replay did not return ok.');
if (replay.response.manifestToolCount !== manifest.tools.length) {
  failures.push('Health replay manifest count mismatch.');
}
if (replay.auditLog.length !== 1 || replay.auditLog[0]?.mutates) {
  failures.push('Health replay audit log must be read-only.');
}
if (replay.auditLog[0]?.toolName !== 'rawengine.host.health') {
  failures.push('Health replay audit tool mismatch.');
}

const capabilitiesReplay = rawEngineAppServerCapabilitiesReplaySchema.parse(
  buildRawEngineAppServerCapabilitiesReplay({
    requestId: 'capabilities_replay_001',
    toolName: 'rawengine.host.capabilities',
  }),
);

if (capabilitiesReplay.response.tools.length !== manifest.tools.length) {
  failures.push('Capabilities replay tool count mismatch.');
}
if (capabilitiesReplay.auditLog.length !== 1 || capabilitiesReplay.auditLog[0]?.mutates) {
  failures.push('Capabilities replay audit log must be read-only.');
}
if (capabilitiesReplay.auditLog[0]?.toolName !== 'rawengine.host.capabilities') {
  failures.push('Capabilities replay audit tool mismatch.');
}

const routeCatalogReplay = rawEngineAppServerRouteCatalogReplaySchema.parse(
  buildRawEngineAppServerRouteCatalogReplay({
    requestId: 'route_catalog_replay_001',
    toolName: 'rawengine.host.route_catalog',
  }),
);

if (routeCatalogReplay.response.routes.length < 20) {
  failures.push('Route catalog replay must expose mapped editing routes.');
}
for (const expectedFamily of ['ai', 'computational_merge', 'film_look', 'negative_lab', 'tone_color']) {
  if (!routeCatalogReplay.response.routes.some((route) => route.family === expectedFamily)) {
    failures.push(`Route catalog missing ${expectedFamily}.`);
  }
}
if (routeCatalogReplay.auditLog.length !== 1 || routeCatalogReplay.auditLog[0]?.mutates) {
  failures.push('Route catalog replay audit log must be read-only.');
}
if (routeCatalogReplay.auditLog[0]?.toolName !== 'rawengine.host.route_catalog') {
  failures.push('Route catalog replay audit tool mismatch.');
}

const source = [
  'src/utils/rawEngineAppServerHost.ts',
  'src/schemas/agentRuntimeSchemas.ts',
  'docs/agent/app-server-host-skeleton-2026-06-17.md',
]
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

for (const marker of [
  'RAW_ENGINE_APP_SERVER_HOST_MANIFEST',
  'rawengine.host.health',
  'rawengine.host.capabilities',
  'rawengine.host.route_catalog',
  'No UI automation',
  'codex app-server',
  'stdio JSONL',
]) {
  if (!source.includes(marker)) failures.push(`Missing marker ${marker}.`);
}

if (failures.length > 0) {
  console.error(`rawengine app-server host skeleton failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`rawengine app-server host skeleton ok (${manifest.tools.length} tools)`);
