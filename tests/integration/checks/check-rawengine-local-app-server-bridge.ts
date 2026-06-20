#!/usr/bin/env bun

import {
  buildRawEngineLocalAppServerToolRegistryQuery,
  createRawEngineLocalAppServerBridge,
  rawEngineLocalAppServerBridgeCapabilities,
} from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  sampleAiEnhancementApplyCommandEnvelopeV1,
  sampleAiEnhancementCommandEnvelopeV1,
  sampleToneColorApplyCommandEnvelopeV1,
  sampleToneColorCommandEnvelopeV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  aiEnhancementApplyResultV1Schema,
  aiEnhancementCommandEnvelopeV1Schema,
  aiEnhancementDryRunResultV1Schema,
  rawEngineToolRegistryV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  buildSelectiveColorCommandEnvelope,
  buildSelectiveColorImageCommandContext,
} from '../../../src/utils/selectiveColorCommandBridge.ts';

const failures: string[] = [];
const bridge = createRawEngineLocalAppServerBridge();
const commandTypes = bridge.listCommandTypes();

if (!commandTypes.includes('rawengine.local.toolRegistry.query')) failures.push('Tool registry query not registered.');
if (!commandTypes.includes('toneColor.setBasicTone')) failures.push('Basic tone dry-run command not registered.');
if (!commandTypes.includes('toneColor.adjustHsl')) failures.push('Selective color/HSL command not registered.');
if (!commandTypes.includes('ai.enhancement.dryRun')) failures.push('AI enhancement dry-run command not registered.');
if (!commandTypes.includes('ai.enhancement.apply')) failures.push('AI enhancement apply command not registered.');
if (!rawEngineLocalAppServerBridgeCapabilities.mutatingCommands) {
  failures.push('Local app-server bridge must advertise mutating apply paths.');
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

const selectiveColorContext = buildSelectiveColorImageCommandContext({
  expectedGraphRevision: 'graph_rev_local_bridge_selective_color',
  imagePath: '/validation/local-bridge-selective-color.CR3',
  operationId: 'local_bridge_orange',
  sessionId: 'local-app-server-bridge-check',
});
const selectiveColorDryRunCommand = buildSelectiveColorCommandEnvelope(
  { adjustment: { hue: 6, luminance: -8, saturation: 14 }, rangeKey: 'oranges' },
  {
    ...selectiveColorContext,
    commandId: 'command_local_bridge_selective_color_preview',
    correlationId: 'corr_local_bridge_selective_color_preview',
    idempotencyKey: 'idem_local_bridge_selective_color_preview',
  },
  { dryRun: true },
);
const selectiveColorApplyCommand = buildSelectiveColorCommandEnvelope(
  { adjustment: { hue: 6, luminance: -8, saturation: 14 }, rangeKey: 'oranges' },
  {
    ...selectiveColorContext,
    commandId: 'command_local_bridge_selective_color_apply',
    correlationId: 'corr_local_bridge_selective_color_apply',
    idempotencyKey: 'idem_local_bridge_selective_color_apply',
  },
  { dryRun: false },
);

const unmatchedSelectiveApplyBridge = createRawEngineLocalAppServerBridge();
const rejectedSelectiveApply = await unmatchedSelectiveApplyBridge.dispatch(selectiveColorApplyCommand);
if (rejectedSelectiveApply.ok || rejectedSelectiveApply.reason !== 'handler_failed') {
  failures.push('Local app-server bridge must reject selective color apply before a matching dry-run.');
}

const selectiveDryRun = await bridge.dispatch(selectiveColorDryRunCommand);
if (!selectiveDryRun.ok) {
  failures.push(`Selective color dry-run failed: ${selectiveDryRun.message}`);
} else {
  const parsedSelectiveDryRun = toneColorDryRunResultV1Schema.parse(selectiveDryRun.result);
  if (!parsedSelectiveDryRun.parameterDiff.some((diff) => diff.path === '/parameters/orange/hueShiftDegrees')) {
    failures.push('Selective color dry-run result did not include orange hue diff.');
  }
}

const selectiveApplied = await bridge.dispatch(selectiveColorApplyCommand);
if (!selectiveApplied.ok) {
  failures.push(`Selective color apply failed after accepted dry-run: ${selectiveApplied.message}`);
} else {
  const parsedSelectiveApply = toneColorMutationResultV1Schema.parse(selectiveApplied.result);
  if (!parsedSelectiveApply.changedNodeIds.includes('tone_color_hsl:orange:image')) {
    failures.push('Selective color apply result did not report the orange HSL node.');
  }
}

const rejectedUnknown = await bridge.dispatch({ commandType: 'toneColor.setToneCurve' });
if (rejectedUnknown.ok || rejectedUnknown.reason !== 'unknown_command') {
  failures.push('Local app-server bridge should leave unsupported commands unregistered.');
}

const unmatchedAiApplyBridge = createRawEngineLocalAppServerBridge();
const rejectedAiApply = await unmatchedAiApplyBridge.dispatch(sampleAiEnhancementApplyCommandEnvelopeV1);
if (rejectedAiApply.ok || rejectedAiApply.reason !== 'handler_failed') {
  failures.push('Local app-server bridge must reject AI enhancement apply before a matching dry-run.');
}

const aiDryRun = await bridge.dispatch(sampleAiEnhancementCommandEnvelopeV1);
let matchingAiEnhancementApplyCommand = sampleAiEnhancementApplyCommandEnvelopeV1;
if (!aiDryRun.ok) {
  failures.push(`AI enhancement dry-run failed: ${aiDryRun.message}`);
} else {
  const parsedAiDryRun = aiEnhancementDryRunResultV1Schema.parse(aiDryRun.result);
  if (parsedAiDryRun.commandId !== sampleAiEnhancementCommandEnvelopeV1.commandId) {
    failures.push('AI enhancement dry-run result did not preserve commandId.');
  }
  matchingAiEnhancementApplyCommand = aiEnhancementCommandEnvelopeV1Schema.parse({
    ...sampleAiEnhancementApplyCommandEnvelopeV1,
    parameters: {
      ...sampleAiEnhancementApplyCommandEnvelopeV1.parameters,
      acceptedDryRunPlanHash: parsedAiDryRun.dryRunPlanHash,
      acceptedDryRunPlanId: parsedAiDryRun.dryRunPlanId,
    },
  });
}

const aiApplied = await bridge.dispatch(matchingAiEnhancementApplyCommand);
if (!aiApplied.ok) {
  failures.push(`AI enhancement apply failed after accepted dry-run: ${aiApplied.message}`);
} else {
  const parsedAiApply = aiEnhancementApplyResultV1Schema.parse(aiApplied.result);
  if (parsedAiApply.commandId !== matchingAiEnhancementApplyCommand.commandId) {
    failures.push('AI enhancement apply result did not preserve commandId.');
  }
  if (parsedAiApply.sourceGraphRevision !== matchingAiEnhancementApplyCommand.expectedGraphRevision) {
    failures.push('AI enhancement apply result did not preserve source revision.');
  }
}

if (failures.length > 0) {
  console.error('RawEngine local app-server bridge validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('rawengine local app-server bridge ok (tool-registry + tone/hsl/ai dry-run/apply)');
