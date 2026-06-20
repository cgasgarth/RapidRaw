#!/usr/bin/env bun

import {
  ApprovalClass,
  toneColorCommandEnvelopeV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleRawEngineSceneColorPipelineV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { sampleAgentActor, sampleImageTarget } from '../../../packages/rawengine-schema/src/samplePayloadFactories.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  hasBasicToneAdjustmentChange,
} from '../../../src/utils/basicToneCommandBridge.ts';

const context = {
  actor: sampleAgentActor('session_basic_tone_command_bridge'),
  colorPipeline: sampleRawEngineSceneColorPipelineV1,
  commandId: 'command_basic_tone_bridge_preview',
  correlationId: 'corr_basic_tone_bridge_preview',
  expectedGraphRevision: 'graph_rev_basic_tone_source',
  idempotencyKey: 'idem_basic_tone_bridge_preview',
  target: sampleImageTarget('/photos/IMG_0001.CR3'),
};

const adjustments = {
  ...INITIAL_ADJUSTMENTS,
  blacks: -4,
  brightness: 0.25,
  clarity: 12,
  contrast: 18,
  exposure: 0.35,
  highlights: -22,
  saturation: 9,
  shadows: 15,
  whites: 6,
};

const previewCommand = buildBasicToneCommandEnvelope(adjustments, context, { dryRun: true });
const applyCommand = buildBasicToneCommandEnvelope(
  adjustments,
  {
    ...context,
    commandId: 'command_basic_tone_bridge_apply',
    correlationId: 'corr_basic_tone_bridge_apply',
    idempotencyKey: 'idem_basic_tone_bridge_apply',
  },
  { dryRun: false },
);
const runtimePreviewCommand = buildBasicToneCommandEnvelope(
  adjustments,
  buildBasicToneImageCommandContext({
    expectedGraphRevision: 'history_7',
    imagePath: '/photos/runtime/IMG_0002.CR3',
    operationId: 'runtime_preview_1',
    sessionId: 'rapidraw-editor-basic-tone',
  }),
  { dryRun: true },
);

const failures = [];

if (
  previewCommand.approval.approvalClass !== ApprovalClass.PreviewOnly ||
  previewCommand.approval.state !== 'not_required'
) {
  failures.push('Preview command must use preview-only approval.');
}
if (applyCommand.approval.approvalClass !== ApprovalClass.EditApply || applyCommand.approval.state !== 'approved') {
  failures.push('Apply command must use approved edit-apply approval.');
}
if (previewCommand.parameters.exposureEv !== adjustments.exposure) failures.push('Exposure did not map to exposureEv.');
if (previewCommand.parameters.blackPoint !== adjustments.blacks) failures.push('Blacks did not map to blackPoint.');
if (previewCommand.parameters.whitePoint !== adjustments.whites) failures.push('Whites did not map to whitePoint.');
if (previewCommand.parameters.saturation !== adjustments.saturation) failures.push('Saturation did not map.');
if (!toneColorCommandEnvelopeV1Schema.safeParse(previewCommand).success)
  failures.push('Preview command schema parse failed.');
if (!toneColorCommandEnvelopeV1Schema.safeParse(applyCommand).success)
  failures.push('Apply command schema parse failed.');
if (!toneColorCommandEnvelopeV1Schema.safeParse(runtimePreviewCommand).success) {
  failures.push('Runtime image preview command schema parse failed.');
}
if (!hasBasicToneAdjustmentChange(INITIAL_ADJUSTMENTS, adjustments)) {
  failures.push('Basic tone change detector missed changed adjustments.');
}
if (hasBasicToneAdjustmentChange(adjustments, { ...adjustments })) {
  failures.push('Basic tone change detector reported unchanged adjustments.');
}

const invalidApply = toneColorCommandEnvelopeV1Schema.safeParse({
  ...applyCommand,
  approval: { ...applyCommand.approval, state: 'pending' },
});
if (invalidApply.success) failures.push('Apply command must reject pending approval.');

if (failures.length > 0) {
  console.error('Basic tone command bridge validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('basic tone command bridge ok (preview+apply)');
