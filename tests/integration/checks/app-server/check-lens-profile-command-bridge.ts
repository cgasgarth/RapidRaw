#!/usr/bin/env bun

import {
  createRawEngineLocalAppServerBridge,
  rawEngineLocalAppServerAuditEventV1Schema,
} from '../../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  ApprovalClass,
  lensProfileCommandEnvelopeV1Schema,
  lensProfileDryRunResultV1Schema,
  lensProfileMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
  rawEngineAppServerToolCallValidationV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const failures: string[] = [];
const context = {
  now: () => new Date('2026-07-01T12:00:00.000Z'),
  requestId: 'request_lens_profile_bridge_001',
};
const actor = { id: 'codex-app-server', kind: 'agent' as const, sessionId: 'session_lens_profile_bridge' };
const target = { imagePath: '/photos/session/IMG_0001.CR3', kind: 'image' as const, virtualCopyId: null };
const dryRunCommand = lensProfileCommandEnvelopeV1Schema.parse({
  actor,
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Preview lens/profile correction without mutating project state.',
    state: 'not_required',
  },
  commandId: 'command_lens_profile_dry_run_001',
  commandType: 'lensProfile.dryRunCorrection',
  correlationId: 'corr_lens_profile_001',
  dryRun: true,
  expectedGraphRevision: 'graph_lens_profile_001',
  parameters: {
    lensCorrectionMode: 'manual',
    lensDistortionAmount: 87,
    lensDistortionEnabled: true,
    lensDistortionParams: {
      k1: 0.12,
      k2: -0.03,
      k3: 0.004,
      model: 1,
      tca_vb: -0.01,
      tca_vr: 0.02,
      vig_k1: -0.2,
      vig_k2: 0.05,
      vig_k3: -0.01,
    },
    lensMaker: 'Sony',
    lensModel: 'FE 24-70mm F2.8 GM II',
    lensTcaAmount: 94,
    lensTcaEnabled: true,
    lensVignetteAmount: 112,
    lensVignetteEnabled: true,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target,
});

if (
  lensProfileCommandEnvelopeV1Schema.safeParse({
    ...dryRunCommand,
    parameters: { lensDistortionAmount: 201 },
  }).success
) {
  failures.push('Malformed out-of-range lens/profile command was accepted.');
}

if (
  lensProfileCommandEnvelopeV1Schema.safeParse({
    ...dryRunCommand,
    parameters: { lensMaker: null, lensModel: 'Impossible model' },
  }).success
) {
  failures.push('Lens/profile command accepted model assignment while maker is explicitly cleared.');
}

const bridge = createRawEngineLocalAppServerBridge();
const registryResult = await bridge.dispatch({
  commandType: 'rawengine.local.toolRegistry.query',
  requestId: 'lens_profile_registry_query',
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
      inputSchemaName: 'LensProfileCommandEnvelopeV1',
      jsonRpcRequestId: 'lens_profile_tool_call_001',
      protocol: 'codex_app_server_json_rpc',
      schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
      threadId: 'thread_lens_profile_bridge',
      toolKind: 'dry_run',
      toolName: 'lensprofile.dry_run_command',
      transport: 'stdio',
      turnId: 'turn_lens_profile_bridge',
    },
  });
  if (!dryRunValidation.success) {
    failures.push('Typed app-server validation rejected executable lens/profile dry-run tool metadata.');
  }
}

const dryRun = await bridge.dispatch(dryRunCommand, context);
if (!dryRun.ok) {
  failures.push(`Lens/profile dry-run failed: ${dryRun.message}`);
}

if (dryRun.ok) {
  const parsedDryRun = lensProfileDryRunResultV1Schema.parse(dryRun.result);
  if (parsedDryRun.mutates || parsedDryRun.sourceGraphRevision !== dryRunCommand.expectedGraphRevision) {
    failures.push('Lens/profile dry-run must preserve source graph identity and remain non-mutating.');
  }
  if (parsedDryRun.predictedGraphRevision === dryRunCommand.expectedGraphRevision) {
    failures.push('Lens/profile dry-run must return a distinct predicted graph revision.');
  }
  if (parsedDryRun.parameterDiff.length < 10) {
    failures.push('Lens/profile dry-run must describe the full representative patch.');
  }

  const staleApply = await bridge.dispatch(
    lensProfileCommandEnvelopeV1Schema.parse({
      ...dryRunCommand,
      approval: {
        approvalClass: ApprovalClass.EditApply,
        reason: 'Apply accepted lens/profile dry-run plan.',
        state: 'approved',
      },
      commandId: 'command_lens_profile_apply_stale',
      commandType: 'lensProfile.applyCorrection',
      dryRun: false,
      expectedGraphRevision: 'graph_lens_profile_stale',
      parameters: {
        ...dryRunCommand.parameters,
        acceptedDryRunPlanHash: parsedDryRun.dryRunPlanHash,
        acceptedDryRunPlanId: parsedDryRun.dryRunPlanId,
      },
    }),
    context,
  );
  if (staleApply.ok || staleApply.reason !== 'handler_failed') {
    failures.push('Lens/profile apply must reject stale graph revision even with accepted dry-run identity.');
  }

  const apply = await bridge.dispatch(
    lensProfileCommandEnvelopeV1Schema.parse({
      ...dryRunCommand,
      approval: {
        approvalClass: ApprovalClass.EditApply,
        reason: 'Apply accepted lens/profile dry-run plan.',
        state: 'approved',
      },
      commandId: 'command_lens_profile_apply_001',
      commandType: 'lensProfile.applyCorrection',
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
    failures.push(`Lens/profile apply failed after accepted dry-run: ${apply.message}`);
  } else {
    const parsedApply = lensProfileMutationResultV1Schema.parse(apply.result);
    if (
      !parsedApply.mutates ||
      parsedApply.sourceGraphRevision !== dryRunCommand.expectedGraphRevision ||
      parsedApply.appliedGraphRevision === parsedApply.sourceGraphRevision
    ) {
      failures.push('Lens/profile apply must mutate result identity and advance graph revision.');
    }
    if (
      parsedApply.dryRunPlanHash !== parsedDryRun.dryRunPlanHash ||
      parsedApply.dryRunPlanId !== parsedDryRun.dryRunPlanId ||
      parsedApply.provenanceEntryIds.length === 0
    ) {
      failures.push('Lens/profile apply must preserve accepted dry-run identity and provenance.');
    }
  }
}

const auditEvents = bridge.listAuditEvents().map((event) => rawEngineLocalAppServerAuditEventV1Schema.parse(event));
if (!auditEvents.some((event) => event.toolName === 'lensprofile.dry_run_command' && !event.mutates)) {
  failures.push('Lens/profile dry-run audit must include tool provenance and non-mutating status.');
}
if (!auditEvents.some((event) => event.toolName === 'lensprofile.apply_command' && event.mutates)) {
  failures.push('Lens/profile apply audit must include tool provenance and mutating status.');
}

if (failures.length > 0) {
  console.error(`Lens/profile command bridge failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('lens/profile command bridge ok');
