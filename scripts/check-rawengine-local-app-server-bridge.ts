#!/usr/bin/env bun

import {
  buildRawEngineLocalAppServerToolRegistryQuery,
  createRawEngineLocalAppServerBridge,
  rawEngineLocalAppServerBridgeCapabilities,
} from '../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  sampleToneColorApplyCommandEnvelopeV1,
  sampleToneColorCommandEnvelopeV1,
} from '../packages/rawengine-schema/src/samplePayloads.ts';
import {
  rawEngineToolRegistryV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../packages/rawengine-schema/src/rawEngineSchemas.ts';

const failures: string[] = [];
const bridge = createRawEngineLocalAppServerBridge();
const commandTypes = bridge.listCommandTypes();

if (!commandTypes.includes('rawengine.local.toolRegistry.query')) failures.push('Tool registry query not registered.');
if (!commandTypes.includes('toneColor.setBasicTone')) failures.push('Basic tone dry-run command not registered.');
if (!rawEngineLocalAppServerBridgeCapabilities.mutatingCommands) {
  failures.push('Local app-server bridge must advertise the basic-tone mutating apply path.');
}

const toolRegistry = await bridge.dispatch(buildRawEngineLocalAppServerToolRegistryQuery('local_bridge_tool_registry'));
if (!toolRegistry.ok) {
  failures.push(`Tool registry query failed: ${toolRegistry.message}`);
} else {
  const parsedRegistry = rawEngineToolRegistryV1Schema.parse(toolRegistry.result);
  if (!parsedRegistry.tools.some((tool) => tool.toolName === 'tonecolor.dry_run_command')) {
    failures.push('Tool registry does not expose tonecolor.dry_run_command.');
  }
}

const dryRun = await bridge.dispatch(sampleToneColorCommandEnvelopeV1);
if (!dryRun.ok) {
  failures.push(`Basic tone dry-run failed: ${dryRun.message}`);
} else {
  const parsedDryRun = toneColorDryRunResultV1Schema.parse(dryRun.result);
  if (parsedDryRun.mutates) failures.push('Basic tone dry-run result must be non-mutating.');
  if (parsedDryRun.commandId !== sampleToneColorCommandEnvelopeV1.commandId) {
    failures.push('Basic tone dry-run result did not preserve commandId.');
  }
  if (!parsedDryRun.parameterDiff.some((diff) => diff.path === '/parameters/exposureEv')) {
    failures.push('Basic tone dry-run result did not include exposureEv diff.');
  }
}

const unmatchedApplyBridge = createRawEngineLocalAppServerBridge();
const rejectedApply = await unmatchedApplyBridge.dispatch(sampleToneColorApplyCommandEnvelopeV1);
if (rejectedApply.ok || rejectedApply.reason !== 'handler_failed') {
  failures.push('Local app-server bridge must reject apply-shaped basic tone commands before a matching dry-run.');
}

const applied = await bridge.dispatch(sampleToneColorApplyCommandEnvelopeV1);
if (!applied.ok) {
  failures.push(`Basic tone apply failed after accepted dry-run: ${applied.message}`);
} else {
  const parsedApply = toneColorMutationResultV1Schema.parse(applied.result);
  if (!parsedApply.mutates) failures.push('Basic tone apply result must mutate.');
  if (parsedApply.commandId !== sampleToneColorApplyCommandEnvelopeV1.commandId) {
    failures.push('Basic tone apply result did not preserve commandId.');
  }
  if (parsedApply.sourceGraphRevision !== sampleToneColorApplyCommandEnvelopeV1.expectedGraphRevision) {
    failures.push('Basic tone apply result did not preserve source revision.');
  }
}

const rejectedUnknown = await bridge.dispatch({ commandType: 'toneColor.setToneCurve' });
if (rejectedUnknown.ok || rejectedUnknown.reason !== 'unknown_command') {
  failures.push('Local app-server bridge should leave unsupported commands unregistered.');
}

if (failures.length > 0) {
  console.error('RawEngine local app-server bridge validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('rawengine local app-server bridge ok (tool-registry read + basic-tone dry-run/apply)');
