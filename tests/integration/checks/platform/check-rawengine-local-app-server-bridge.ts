#!/usr/bin/env bun

import {
  buildRawEngineLocalAppServerToolRegistryQuery,
  createRawEngineLocalAppServerBridge,
  RawEngineLocalAppServerCommandType,
  rawEngineLocalAppServerBridgeCapabilities,
  rawEngineLocalAppServerEditorStateResultV1Schema,
  rawEngineLocalAppServerImageMetadataResultV1Schema,
  rawEngineLocalAppServerProjectMetadataResultV1Schema,
  rawEngineLocalAppServerSelectedImagesResultV1Schema,
} from '../../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  aiEnhancementApplyResultV1Schema,
  aiEnhancementCommandEnvelopeV1Schema,
  aiEnhancementDryRunResultV1Schema,
  rawEngineToolRegistryV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleAiEnhancementApplyCommandEnvelopeV1,
  sampleAiEnhancementCommandEnvelopeV1,
  sampleRawEngineSceneColorPipelineV1,
  sampleToneColorApplyCommandEnvelopeV1,
  sampleToneColorCommandEnvelopeV1,
} from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  buildSelectiveColorCommandEnvelope,
  buildSelectiveColorImageCommandContext,
} from '../../../../src/utils/selectiveColorCommandBridge.ts';

const failures: string[] = [];
const bridge = createRawEngineLocalAppServerBridge();
const commandTypes = bridge.listCommandTypes();

if (!commandTypes.includes('rawengine.local.toolRegistry.query')) failures.push('Tool registry query not registered.');
if (!commandTypes.includes(RawEngineLocalAppServerCommandType.ProjectMetadataQuery)) {
  failures.push('Agent project metadata query not registered.');
}
if (!commandTypes.includes(RawEngineLocalAppServerCommandType.SelectedImagesQuery)) {
  failures.push('Agent selected images query not registered.');
}
if (!commandTypes.includes(RawEngineLocalAppServerCommandType.ImageMetadataQuery)) {
  failures.push('Agent image metadata query not registered.');
}
if (!commandTypes.includes(RawEngineLocalAppServerCommandType.EditorStateQuery)) {
  failures.push('Agent editor state query not registered.');
}
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
  const advertisedToolNames = new Set(parsedRegistry.tools.map((tool) => tool.toolName));
  if (!parsedRegistry.tools.some((tool) => tool.toolName === 'tonecolor.dry_run_command')) {
    failures.push('Tool registry does not expose tonecolor.dry_run_command.');
  }
  for (const toolName of [
    'computationalmerge.panorama.dry_run_command',
    'export.write_files',
    'project.library_mutate',
  ]) {
    if (advertisedToolNames.has(toolName)) {
      failures.push(`Local app-server bridge must not advertise unbound tool ${toolName}.`);
    }
  }
  for (const toolName of [
    'agent.project_metadata.query',
    'agent.selected_images.query',
    'agent.image_metadata.query',
    'agent.editor_state.query',
    'tonecolor.dry_run_command',
    'tonecolor.apply_command',
    'ai.mask.dry_run_subject',
    'ai.mask.apply_subject',
    'ai.enhancement.dry_run_command',
    'ai.enhancement.apply_command',
  ]) {
    const tool = parsedRegistry.tools.find((candidate) => candidate.toolName === toolName);
    if (tool === undefined) {
      failures.push(`Tool registry does not expose ${toolName}.`);
    } else if (toolName.startsWith('agent.') && (tool.mutates || tool.toolKind !== 'read')) {
      failures.push(`${toolName} must be a non-mutating read tool.`);
    }
  }
}

const projectMetadata = await bridge.dispatch(buildReadQuery(RawEngineLocalAppServerCommandType.ProjectMetadataQuery));
if (!projectMetadata.ok) {
  failures.push(`Agent project metadata query failed: ${projectMetadata.message}`);
} else {
  const parsedProjectMetadata = rawEngineLocalAppServerProjectMetadataResultV1Schema.parse(projectMetadata.result);
  if (parsedProjectMetadata.imageCount < 1) failures.push('Agent project metadata must report visible images.');
  if (parsedProjectMetadata.selectedCount !== 1) failures.push('Agent project metadata must report selected count.');
}

const selectedImages = await bridge.dispatch(buildReadQuery(RawEngineLocalAppServerCommandType.SelectedImagesQuery));
if (!selectedImages.ok) {
  failures.push(`Agent selected images query failed: ${selectedImages.message}`);
} else {
  const parsedSelectedImages = rawEngineLocalAppServerSelectedImagesResultV1Schema.parse(selectedImages.result);
  if (parsedSelectedImages.selectedPaths[0] !== '/photos/session/IMG_0001.CR3') {
    failures.push('Agent selected images query did not preserve selected path.');
  }
  if (parsedSelectedImages.images[0]?.rating !== 4) {
    failures.push('Agent selected images query did not include rating metadata.');
  }
}

const imageMetadata = await bridge.dispatch({
  ...buildReadQuery(RawEngineLocalAppServerCommandType.ImageMetadataQuery),
  imagePath: '/photos/session/IMG_0001.CR3',
});
if (!imageMetadata.ok) {
  failures.push(`Agent image metadata query failed: ${imageMetadata.message}`);
} else {
  const parsedImageMetadata = rawEngineLocalAppServerImageMetadataResultV1Schema.parse(imageMetadata.result);
  if (parsedImageMetadata.image.exif?.ISO !== '400') {
    failures.push('Agent image metadata query did not include EXIF.');
  }
  if (!parsedImageMetadata.image.tags?.includes('portrait')) {
    failures.push('Agent image metadata query did not include labels/tags.');
  }
}

const editorState = await bridge.dispatch(buildReadQuery(RawEngineLocalAppServerCommandType.EditorStateQuery));
if (!editorState.ok) {
  failures.push(`Agent editor state query failed: ${editorState.message}`);
} else {
  const parsedEditorState = rawEngineLocalAppServerEditorStateResultV1Schema.parse(editorState.result);
  if (parsedEditorState.activeImagePath !== '/photos/session/IMG_0001.CR3') {
    failures.push('Agent editor state query did not report active image path.');
  }
  if (parsedEditorState.selectedImagePaths.length !== 1) {
    failures.push('Agent editor state query did not report selected image paths.');
  }
}

for (const toolName of [
  'agent.project_metadata.query',
  'agent.selected_images.query',
  'agent.image_metadata.query',
  'agent.editor_state.query',
]) {
  const event = bridge.listAuditEvents().find((auditEvent) => auditEvent.toolName === toolName);
  if (event === undefined) {
    failures.push(`Missing audit event for ${toolName}.`);
  } else if (event.mutates || event.status !== 'completed') {
    failures.push(`${toolName} audit event must be completed and non-mutating.`);
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
  colorPipeline: sampleRawEngineSceneColorPipelineV1,
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

function buildReadQuery(commandType: RawEngineLocalAppServerCommandType) {
  const suffix = commandType.replaceAll('.', '_');
  return {
    commandId: `command_${suffix}`,
    commandType,
    correlationId: `corr_${suffix}`,
    dryRun: false,
    requestId: `request_${suffix}`,
  };
}
