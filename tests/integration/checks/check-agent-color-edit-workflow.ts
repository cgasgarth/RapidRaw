#!/usr/bin/env bun

import { runAgentColorEditWorkflowV1 } from '../../../packages/rawengine-schema/src/agentColorEditWorkflow.ts';
import { createRawEngineLocalAppServerBridge } from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  RAW_ENGINE_SCHEMA_VERSION,
  toneColorCommandEnvelopeV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleRawEngineSceneColorPipelineV1,
  sampleToneColorApplyCommandEnvelopeV1,
  sampleToneColorCommandEnvelopeV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const context = {
  now: () => new Date('2026-06-22T08:00:00.000Z'),
  requestId: 'request_agent_color_edit_workflow',
};

const toneSummary = await runAgentColorEditWorkflowV1({
  applyCommand: sampleToneColorApplyCommandEnvelopeV1,
  bridge: createRawEngineLocalAppServerBridge(),
  context,
  dryRunCommand: sampleToneColorCommandEnvelopeV1,
});
if (!toneSummary.dryRun.parameterDiffPaths.includes('/parameters/exposureEv')) {
  throw new Error('Agent color workflow basic tone dry-run must expose exposure diff.');
}
if (!toneSummary.apply.changedNodeIds.includes('tone_color_basic:image')) {
  throw new Error('Agent color workflow basic tone apply must mutate the basic tone node.');
}

const hslDryRunCommand = toneColorCommandEnvelopeV1Schema.parse({
  actor: {
    id: 'codex-app-server',
    kind: 'agent',
    sessionId: 'session_agent_color_edit_workflow',
  },
  approval: {
    approvalClass: 'preview_only',
    reason: 'Preview orange color mixer adjustment before mutating the virtual copy.',
    state: 'not_required',
  },
  colorPipeline: sampleRawEngineSceneColorPipelineV1,
  commandId: 'command_agent_color_hsl_dry_run',
  commandType: 'toneColor.adjustHsl',
  correlationId: 'corr_agent_color_hsl',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_agent_color_hsl_initial',
  idempotencyKey: 'idem_agent_color_hsl_dry_run',
  parameters: {
    band: 'orange',
    hueShiftDegrees: -4,
    luminance: 6,
    saturation: 12,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: {
    imagePath: '/photos/agent-color/DSC_1199.NEF',
    kind: 'image',
    virtualCopyId: 'vc_agent_color_hsl_1199',
  },
});

const hslApplyCommand = toneColorCommandEnvelopeV1Schema.parse({
  ...hslDryRunCommand,
  approval: {
    approvalClass: 'edit_apply',
    reason: 'Apply accepted orange color mixer adjustment to the virtual-copy edit graph.',
    state: 'approved',
  },
  commandId: 'command_agent_color_hsl_apply',
  dryRun: false,
  idempotencyKey: 'idem_agent_color_hsl_apply',
});

const hslBridge = createRawEngineLocalAppServerBridge();
const rejectedHslApply = await createRawEngineLocalAppServerBridge().dispatch(hslApplyCommand, context);
if (rejectedHslApply.ok || rejectedHslApply.reason !== 'handler_failed') {
  throw new Error('Agent color workflow must reject HSL apply before matching dry-run.');
}

const hslSummary = await runAgentColorEditWorkflowV1({
  applyCommand: hslApplyCommand,
  bridge: hslBridge,
  context,
  dryRunCommand: hslDryRunCommand,
});
if (!hslSummary.dryRun.parameterDiffPaths.includes('/parameters/orange/saturation')) {
  throw new Error('Agent color workflow HSL dry-run must expose orange saturation diff.');
}
if (!hslSummary.apply.changedNodeIds.includes('tone_color_hsl:orange:image')) {
  throw new Error('Agent color workflow HSL apply must mutate the orange HSL node.');
}
if (hslSummary.audit.eventCount !== 2) {
  throw new Error('Agent color workflow must record dry-run and apply audit events.');
}

console.log('agent color edit workflow ok (basic tone + HSL dry-run/apply/audit)');
