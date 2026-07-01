#!/usr/bin/env bun

import {
  ActorKind,
  ApprovalClass,
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  RawEngineAppServerHostToolName,
  RawEngineAppServerResponseStatus,
} from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { handleRawEngineAppServerHostRequestAsync } from '../../../../src/utils/rawEngineAppServerHost.ts';

const failures: string[] = [];

const buildGradientCommand = ({
  dryRun,
  expectedGraphRevision = 'graph_rev_agent_mask_bridge_source',
}: {
  dryRun: boolean;
  expectedGraphRevision?: string;
}) => ({
  actor: {
    id: 'rawengine-agent',
    kind: ActorKind.Agent,
    sessionId: 'session_agent_mask_bridge',
  },
  approval: dryRun
    ? {
        approvalClass: ApprovalClass.PreviewOnly,
        reason: 'Preview mask before app-server bridge apply.',
        state: 'not_required',
      }
    : {
        approvalClass: ApprovalClass.EditApply,
        reason: 'Apply accepted mask through the typed app-server bridge.',
        state: 'approved',
      },
  commandId: dryRun ? 'command_agent_mask_bridge_preview' : 'command_agent_mask_bridge_apply',
  commandType: 'layerMask.createGradientMask',
  correlationId: 'corr_agent_mask_bridge',
  dryRun,
  expectedGraphRevision,
  idempotencyKey: dryRun ? 'idem_agent_mask_bridge_preview' : 'idem_agent_mask_bridge_apply',
  parameters: {
    gradient: {
      end: { x: 1, y: 0.42 },
      feather: 0.18,
      gradientKind: 'linear',
      invert: false,
      start: { x: 0, y: 0.42 },
    },
    maskName: 'Agent sky gradient',
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: {
    imagePath: '/photos/session/IMG_0001.CR3',
    kind: 'image',
  },
});

const dispatch = async (runtimeToolName: string, args: unknown, requestId: string) =>
  await handleRawEngineAppServerHostRequestAsync({
    arguments: args,
    requestId,
    runtimeToolName,
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  });

const dryRunResponse = await dispatch(
  'layermask.dry_run_command',
  buildGradientCommand({ dryRun: true }),
  'agent-mask-bridge-dry-run',
);
if (
  dryRunResponse.status !== RawEngineAppServerResponseStatus.Ok ||
  !('dispatchStatus' in dryRunResponse) ||
  dryRunResponse.dispatchStatus !== 'completed'
) {
  failures.push('Valid layer-mask dry-run did not dispatch through the app-server host.');
} else {
  const dryRun = layerMaskDryRunResultV1Schema.parse(dryRunResponse.result);
  if (
    dryRun.mutates ||
    dryRun.sourceGraphRevision !== 'graph_rev_agent_mask_bridge_source' ||
    dryRun.maskArtifacts[0]?.kind !== 'mask' ||
    dryRun.maskArtifacts[0].storage !== 'temp_cache'
  ) {
    failures.push('Layer-mask dry-run did not return a non-mutating mask artifact receipt.');
  }
}

const invalidResponse = await dispatch(
  'layermask.dry_run_command',
  {
    ...buildGradientCommand({ dryRun: true }),
    parameters: {
      gradient: {
        end: { x: 1, y: 0.5 },
        feather: 0,
        gradientKind: 'linear',
        invert: false,
        start: { x: 1.2, y: 0.5 },
      },
      maskName: 'Invalid gradient',
    },
  },
  'agent-mask-bridge-invalid',
);
if (
  invalidResponse.status !== RawEngineAppServerResponseStatus.Ok ||
  !('dispatchStatus' in invalidResponse) ||
  invalidResponse.dispatchStatus !== 'rejected' ||
  !invalidResponse.schemaIssues?.some((issue) => issue.path.join('.') === 'toolCall.arguments')
) {
  failures.push('Invalid layer-mask payload was not rejected at typed tool-call validation.');
}

const applyResponse = await dispatch(
  'layermask.apply_command',
  buildGradientCommand({ dryRun: false }),
  'agent-mask-bridge-apply',
);
if (
  applyResponse.status !== RawEngineAppServerResponseStatus.Ok ||
  !('dispatchStatus' in applyResponse) ||
  applyResponse.dispatchStatus !== 'completed'
) {
  failures.push('Accepted layer-mask apply did not dispatch through the app-server host.');
} else {
  const apply = layerMaskMutationResultV1Schema.parse(applyResponse.result);
  if (
    !apply.mutates ||
    apply.sourceGraphRevision !== 'graph_rev_agent_mask_bridge_source' ||
    apply.undoRevision !== 'graph_rev_agent_mask_bridge_source' ||
    apply.changedMaskIds[0] !== 'mask_linear_gradient_agent_sky_gradient'
  ) {
    failures.push('Layer-mask apply did not return structured mutation and rollback receipt fields.');
  }
}

const staleApplyResponse = await dispatch(
  'layermask.apply_command',
  buildGradientCommand({ dryRun: false, expectedGraphRevision: 'graph_rev_agent_mask_bridge_stale' }),
  'agent-mask-bridge-stale-apply',
);
if (
  staleApplyResponse.status !== RawEngineAppServerResponseStatus.Ok ||
  !('dispatchStatus' in staleApplyResponse) ||
  staleApplyResponse.dispatchStatus !== 'rejected' ||
  !staleApplyResponse.message?.includes('matching dry-run')
) {
  failures.push('Stale layer-mask apply was not rejected before mutation.');
}

if (failures.length > 0) {
  console.error(`App-server layer-mask tool dispatch failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('app-server layer-mask tool dispatch ok');
