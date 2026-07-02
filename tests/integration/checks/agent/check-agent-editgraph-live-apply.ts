#!/usr/bin/env bun

import { z } from 'zod';

import {
  ActorKind,
  ApprovalClass,
  type EditGraphParameterPatchOperationV1,
  editGraphCommandEnvelopeV1Schema,
  editGraphDryRunResultV1Schema,
  editGraphMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { RawEngineAppServerHostToolName } from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../../src/utils/agent/context/agentImageContextSnapshot.ts';
import { handleRawEngineAppServerHostRequestAsync } from '../../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/_DSC7511.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 8 : 2));

const dispatchResponseSchema = z
  .object({
    dispatchStatus: z.enum(['completed', 'rejected']),
    message: z.string().optional(),
    result: z.unknown().optional(),
    runtimeToolName: z.string().min(1),
  })
  .passthrough();

const dispatch = async (runtimeToolName: string, args: unknown, requestId: string) =>
  dispatchResponseSchema.parse(
    await handleRawEngineAppServerHostRequestAsync({
      arguments: args,
      requestId,
      runtimeToolName,
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    }),
  );

const buildCommand = ({
  commandId,
  dryRun,
  expectedGraphRevision,
  operations,
}: {
  commandId: string;
  dryRun: boolean;
  expectedGraphRevision: string;
  operations: EditGraphParameterPatchOperationV1[];
}) =>
  editGraphCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'rawengine-agent',
      kind: ActorKind.Agent,
      sessionId: 'agent-editgraph-live-session',
    },
    approval: dryRun
      ? {
          approvalClass: ApprovalClass.PreviewOnly,
          reason: 'Preview editGraph parameter patch before mutating the live editor.',
          state: 'not_required',
        }
      : {
          approvalClass: ApprovalClass.EditApply,
          reason: 'Apply approved editGraph parameter patch to the live editor.',
          state: 'approved',
        },
    commandId,
    commandType: 'editGraph.applyParameterPatch',
    correlationId: 'corr_agent_editgraph_live',
    dryRun,
    expectedGraphRevision,
    idempotencyKey: `agent-editgraph-live:${commandId}`,
    parameters: {
      label: 'Agent live editGraph patch',
      operations,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: selectedPath,
      kind: 'image',
    },
  });

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  finalPreviewUrl: 'blob:rawengine-editgraph-before',
  hasRenderedFirstFrame: true,
  histogram: {
    [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
    [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
    [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
    [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
  },
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  selectedImage: {
    exif: { ISO: '100', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-editgraph',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-editgraph',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: null,
});

const initialSnapshot = buildAgentImageContextSnapshot();
const expectedGraphRevision = initialSnapshot.graphRevision;
const operations: EditGraphParameterPatchOperationV1[] = [
  {
    nodeId: 'legacy_adjustments',
    op: 'replace',
    path: '/adjustments/brightness',
    previousValue: INITIAL_ADJUSTMENTS.brightness,
    value: 1.4,
  },
  {
    nodeId: 'legacy_adjustments',
    op: 'replace',
    path: '/adjustments/contrast',
    previousValue: INITIAL_ADJUSTMENTS.contrast,
    value: 18,
  },
];

const dryRun = await dispatch(
  'editgraph.dry_run_command',
  buildCommand({
    commandId: 'agent_editgraph_live_dry_run',
    dryRun: true,
    expectedGraphRevision,
    operations,
  }),
  'agent-editgraph-live-dry-run',
);
if (dryRun.dispatchStatus !== 'completed') {
  throw new Error(`editgraph.dry_run_command rejected: ${dryRun.message ?? 'missing message'}`);
}
const dryRunPayload = editGraphDryRunResultV1Schema.parse(dryRun.result);
if (
  dryRunPayload.sourceGraphRevision !== expectedGraphRevision ||
  dryRunPayload.parameterDiff.length !== operations.length ||
  useEditorStore.getState().historyIndex !== 0
) {
  throw new Error('editgraph.dry_run_command did not return a non-mutating bound diff.');
}

const staleApply = await dispatch(
  'editgraph.apply_command',
  buildCommand({
    commandId: 'agent_editgraph_live_stale_apply',
    dryRun: false,
    expectedGraphRevision: 'history_stale',
    operations,
  }),
  'agent-editgraph-live-stale-apply',
);
if (staleApply.dispatchStatus !== 'rejected' || !staleApply.message?.includes('stale graph revision')) {
  throw new Error('editgraph.apply_command accepted a stale graph revision.');
}

const apply = await dispatch(
  'editgraph.apply_command',
  buildCommand({
    commandId: 'agent_editgraph_live_apply',
    dryRun: false,
    expectedGraphRevision,
    operations,
  }),
  'agent-editgraph-live-apply',
);
if (apply.dispatchStatus !== 'completed') {
  throw new Error(`editgraph.apply_command rejected: ${apply.message ?? 'missing message'}`);
}
const applyPayload = editGraphMutationResultV1Schema.parse(apply.result);
const finalState = useEditorStore.getState();
const finalSnapshot = buildAgentImageContextSnapshot();
if (
  applyPayload.sourceGraphRevision !== expectedGraphRevision ||
  finalState.historyIndex !== 1 ||
  finalState.adjustments.brightness !== 1.4 ||
  finalState.adjustments.contrast !== 18 ||
  finalSnapshot.initialPreview.recipeHash === initialSnapshot.initialPreview.recipeHash
) {
  throw new Error('editgraph.apply_command did not mutate the live editor state and refresh recipe identity.');
}

console.log('agent editgraph live apply ok');
