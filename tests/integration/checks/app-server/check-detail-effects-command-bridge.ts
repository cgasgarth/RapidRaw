#!/usr/bin/env bun

import {
  createRawEngineLocalAppServerBridge,
  rawEngineLocalAppServerAuditEventV1Schema,
} from '../../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  ApprovalClass,
  detailDeblurCommandEnvelopeV1Schema,
  detailEffectsCommandEnvelopeV1Schema,
  detailEffectsDryRunResultV1Schema,
  detailEffectsMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
  rawEngineAppServerToolCallValidationV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const failures: string[] = [];
const context = {
  now: () => new Date('2026-07-01T12:00:00.000Z'),
  requestId: 'request_detail_effects_bridge_001',
};
const actor = { id: 'codex-app-server', kind: 'agent' as const, sessionId: 'session_detail_effects_bridge' };
const target = { imagePath: '/photos/session/IMG_0001.CR3', kind: 'image' as const, virtualCopyId: null };
const dryRunCommand = detailEffectsCommandEnvelopeV1Schema.parse({
  actor,
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Preview detail/effects adjustment patch without mutating project state.',
    state: 'not_required',
  },
  commandId: 'command_detail_effects_dry_run_001',
  commandType: 'detailEffects.dryRunAdjustments',
  correlationId: 'corr_detail_effects_001',
  dryRun: true,
  expectedGraphRevision: 'graph_detail_effects_001',
  parameters: {
    clarity: 9,
    colorNoiseReduction: 12,
    deblurEnabled: true,
    deblurSigmaPx: 0.9,
    deblurStrength: 24,
    grainAmount: 18,
    lumaNoiseReduction: 16,
    sharpness: 18,
    vignetteAmount: -14,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target,
});

if (
  detailEffectsCommandEnvelopeV1Schema.safeParse({
    ...dryRunCommand,
    parameters: { grainAmount: 101 },
  }).success
) {
  failures.push('Malformed out-of-range detail/effects command was accepted.');
}

const bridge = createRawEngineLocalAppServerBridge();
const registryResult = await bridge.dispatch({
  commandType: 'rawengine.local.toolRegistry.query',
  requestId: 'detail_effects_registry_query',
});
if (!registryResult.ok) {
  failures.push(`Tool registry query failed: ${registryResult.message}`);
} else {
  const registry = registryResult.result;
  const dryRunValidation = rawEngineAppServerToolCallValidationV1Schema.safeParse({
    registry,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    toolCall: {
      approval: dryRunCommand.approval,
      arguments: dryRunCommand,
      dryRun: true,
      inputSchemaName: 'DetailEffectsCommandEnvelopeV1',
      jsonRpcRequestId: 'detail_effects_tool_call_001',
      protocol: 'codex_app_server_json_rpc',
      schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
      threadId: 'thread_detail_effects_bridge',
      toolKind: 'dry_run',
      toolName: 'detail.effects.dry_run_command',
      transport: 'stdio',
      turnId: 'turn_detail_effects_bridge',
    },
  });
  if (!dryRunValidation.success) {
    failures.push('Typed app-server validation rejected executable detail/effects dry-run tool metadata.');
  }

  const excludedDeblur = rawEngineAppServerToolCallValidationV1Schema.safeParse({
    registry,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    toolCall: {
      approval: dryRunCommand.approval,
      arguments: dryRunCommand,
      dryRun: true,
      inputSchemaName: 'DetailEffectsCommandEnvelopeV1',
      jsonRpcRequestId: 'detail_effects_tool_call_excluded_deblur',
      protocol: 'codex_app_server_json_rpc',
      schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
      threadId: 'thread_detail_effects_bridge',
      toolKind: 'dry_run',
      toolName: 'detail.deblur.dry_run_command',
      transport: 'stdio',
      turnId: 'turn_detail_effects_bridge',
    },
  });
  if (excludedDeblur.success) {
    failures.push('Local executable registry exposed excluded deblur route as executable.');
  }
}

const dryRun = await bridge.dispatch(dryRunCommand, context);
if (!dryRun.ok) {
  failures.push(`Detail/effects dry-run failed: ${dryRun.message}`);
}

if (dryRun.ok) {
  const parsedDryRun = detailEffectsDryRunResultV1Schema.parse(dryRun.result);
  if (parsedDryRun.mutates || parsedDryRun.sourceGraphRevision !== dryRunCommand.expectedGraphRevision) {
    failures.push('Detail/effects dry-run must preserve source graph identity and remain non-mutating.');
  }
  if (parsedDryRun.predictedGraphRevision === dryRunCommand.expectedGraphRevision) {
    failures.push('Detail/effects dry-run must return a distinct predicted graph revision.');
  }

  const staleApply = await bridge.dispatch(
    detailEffectsCommandEnvelopeV1Schema.parse({
      ...dryRunCommand,
      approval: {
        approvalClass: ApprovalClass.EditApply,
        reason: 'Apply accepted detail/effects dry-run plan.',
        state: 'approved',
      },
      commandId: 'command_detail_effects_apply_stale',
      commandType: 'detailEffects.applyAdjustments',
      dryRun: false,
      expectedGraphRevision: 'graph_detail_effects_stale',
      parameters: {
        ...dryRunCommand.parameters,
        acceptedDryRunPlanHash: parsedDryRun.dryRunPlanHash,
        acceptedDryRunPlanId: parsedDryRun.dryRunPlanId,
      },
    }),
    context,
  );
  if (staleApply.ok || staleApply.reason !== 'handler_failed') {
    failures.push('Detail/effects apply must reject stale graph revision even with accepted dry-run identity.');
  }

  const apply = await bridge.dispatch(
    detailEffectsCommandEnvelopeV1Schema.parse({
      ...dryRunCommand,
      approval: {
        approvalClass: ApprovalClass.EditApply,
        reason: 'Apply accepted detail/effects dry-run plan.',
        state: 'approved',
      },
      commandId: 'command_detail_effects_apply_001',
      commandType: 'detailEffects.applyAdjustments',
      dryRun: false,
      parameters: {
        ...dryRunCommand.parameters,
        acceptedDryRunPlanHash: parsedDryRun.dryRunPlanHash,
        acceptedDryRunPlanId: parsedDryRun.dryRunPlanId,
      },
    }),
    context,
  );
  if (!apply.ok) {
    failures.push(`Detail/effects apply failed after accepted dry-run: ${apply.message}`);
  } else {
    const parsedApply = detailEffectsMutationResultV1Schema.parse(apply.result);
    if (
      !parsedApply.mutates ||
      parsedApply.sourceGraphRevision !== dryRunCommand.expectedGraphRevision ||
      parsedApply.appliedGraphRevision === parsedApply.sourceGraphRevision
    ) {
      failures.push('Detail/effects apply must mutate result identity and advance graph revision.');
    }
    if (
      parsedApply.dryRunPlanHash !== parsedDryRun.dryRunPlanHash ||
      parsedApply.dryRunPlanId !== parsedDryRun.dryRunPlanId ||
      parsedApply.provenanceEntryIds.length === 0
    ) {
      failures.push('Detail/effects apply must preserve accepted dry-run identity and provenance.');
    }
  }
}

const deblurCommand = detailDeblurCommandEnvelopeV1Schema.parse({
  actor,
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Deblur route remains explicit unavailable outside detail/effects bridge scope.',
    state: 'not_required',
  },
  commandId: 'command_detail_deblur_unavailable',
  commandType: 'detailDeblur.dryRunControls',
  correlationId: 'corr_detail_deblur_unavailable',
  dryRun: true,
  expectedGraphRevision: 'graph_detail_effects_001',
  parameters: {
    enabled: true,
    psf: 'gaussian',
    sigmaPx: 0.8,
    strength: 0.25,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target,
});
const unavailableDeblur = await bridge.dispatch(deblurCommand, context);
if (unavailableDeblur.ok || unavailableDeblur.reason !== 'unknown_command') {
  failures.push('Local bridge must explicitly leave deblur command handler unavailable in this PR.');
}

const auditEvents = bridge.listAuditEvents().map((event) => rawEngineLocalAppServerAuditEventV1Schema.parse(event));
if (!auditEvents.some((event) => event.toolName === 'detail.effects.dry_run_command' && !event.mutates)) {
  failures.push('Detail/effects dry-run audit must include tool provenance and non-mutating status.');
}
if (!auditEvents.some((event) => event.toolName === 'detail.effects.apply_command' && event.mutates)) {
  failures.push('Detail/effects apply audit must include tool provenance and mutating status.');
}

if (failures.length > 0) {
  console.error(`Detail/effects command bridge failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('detail/effects command bridge ok');
