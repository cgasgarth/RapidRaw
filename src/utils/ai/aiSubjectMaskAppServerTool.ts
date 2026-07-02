import { z } from 'zod';
import {
  createRawEngineLocalAppServerBridge,
  type RawEngineLocalAppServerAuditEventV1,
  type RawEngineLocalAppServerBridge,
  rawEngineLocalAppServerAuditEventV1Schema,
} from '../../../packages/rawengine-schema/src/localAppServerBridge';
import {
  ActorKind,
  type AiToolApplyResultV1,
  type AiToolCommandEnvelopeV1,
  type AiToolDryRunResultV1,
  ApprovalClass,
  aiToolApplyResultV1Schema,
  aiToolCommandEnvelopeV1Schema,
  aiToolDryRunResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas';
import { buildAgentImageContextSnapshot } from '../agent/context/agentImageContextSnapshot';

const aiSubjectMaskProviderClassSchema = z.enum(['cloud_service', 'local_model', 'self_hosted_connector']);

const aiSubjectMaskToolRequestSchema = z
  .object({
    maskName: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    providerId: z.string().trim().min(1),
    providerClass: aiSubjectMaskProviderClassSchema,
    requestId: z.string().trim().min(1),
    selectedImagePath: z.string().trim().min(1),
  })
  .strict();

const aiSubjectMaskToolProviderSchema = z
  .object({
    availableProviderIds: z.array(z.string().trim().min(1)).default([]),
    providerClass: aiSubjectMaskProviderClassSchema,
    providerId: z.string().trim().min(1),
  })
  .strict();

export const aiSubjectMaskToolBlockedResultSchema = z
  .object({
    auditEvents: z.array(rawEngineLocalAppServerAuditEventV1Schema).min(1),
    provider: aiSubjectMaskToolProviderSchema,
    status: z.literal('blocked'),
    userVisibleMessage: z.string().trim().min(1),
  })
  .strict();

export const aiSubjectMaskToolAppliedResultSchema = z
  .object({
    applyResult: aiToolApplyResultV1Schema,
    auditEvents: z.array(rawEngineLocalAppServerAuditEventV1Schema).min(2),
    dryRunResult: aiToolDryRunResultV1Schema,
    provider: aiSubjectMaskToolProviderSchema,
    status: z.literal('applied'),
  })
  .strict();

export const aiSubjectMaskToolResultSchema = z.union([
  aiSubjectMaskToolBlockedResultSchema,
  aiSubjectMaskToolAppliedResultSchema,
]);

export type AiSubjectMaskToolBlockedResult = z.infer<typeof aiSubjectMaskToolBlockedResultSchema>;
export type AiSubjectMaskToolAppliedResult = z.infer<typeof aiSubjectMaskToolAppliedResultSchema>;
export type AiSubjectMaskToolResult = z.infer<typeof aiSubjectMaskToolResultSchema>;
export type AiSubjectMaskToolRequest = z.infer<typeof aiSubjectMaskToolRequestSchema>;

const buildAiSubjectMaskCommand = ({
  approval,
  commandId,
  commandType,
  dryRun,
  expectedGraphRevision,
  parameters,
  request,
}: {
  approval:
    | { approvalClass: typeof ApprovalClass.ExternalModel; reason: string; state: 'not_required' }
    | { approvalClass: typeof ApprovalClass.GenerativeEdit; reason: string; state: 'approved' };
  commandId: string;
  commandType: 'ai.mask.generateSubject' | 'ai.mask.applySubject';
  dryRun: boolean;
  expectedGraphRevision: string;
  parameters: AiToolCommandEnvelopeV1['parameters'];
  request: AiSubjectMaskToolRequest;
}): AiToolCommandEnvelopeV1 =>
  aiToolCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'rawengine-agent',
      kind: ActorKind.Agent,
      sessionId: request.requestId,
    },
    approval,
    commandId,
    commandType,
    correlationId: request.operationId,
    dryRun,
    expectedGraphRevision,
    idempotencyKey: `${request.operationId}:${commandType}`,
    parameters,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: request.selectedImagePath,
      kind: 'image',
    },
  });

const buildCommandParameters = ({
  maskName,
  providerId,
  providerClass,
  sourceContentHash,
}: {
  maskName: string;
  providerClass: AiSubjectMaskToolRequest['providerClass'];
  providerId: string;
  sourceContentHash: string;
}): AiToolCommandEnvelopeV1['parameters'] =>
  ({
    cachePolicy: 'reuse_allowed',
    capability: 'subject_mask',
    maskName,
    maxPreviewDimensionPx: 2048,
    modelHash: 'sha256:local-sam2-subject-mask-model',
    modelId: 'local_sam2_subject_mask',
    modelVersion: '2026.06',
    promptPolicy: 'none',
    providerClass,
    providerId,
    sourceContentHash,
    sourcePixelDisclosure: providerClass === 'local_model' ? 'local_only' : 'may_leave_machine',
  }) satisfies AiToolCommandEnvelopeV1['parameters'];

const buildProviderAvailability = (providerId: string): Array<string> =>
  providerId === 'rawengine-local-ai' ? [providerId] : [];

const buildAiSubjectMaskCommandContext = (request: AiSubjectMaskToolRequest) => {
  const snapshot = buildAgentImageContextSnapshot();
  const sourceContentHash = snapshot.initialPreview.renderHash;
  const availableProviderIds = buildProviderAvailability(request.providerId);
  const provider = aiSubjectMaskToolProviderSchema.parse({
    availableProviderIds,
    providerClass: request.providerClass,
    providerId: request.providerId,
  });
  return {
    availableProviderIds,
    provider,
    snapshot,
    sourceContentHash,
  };
};

const buildAuditEventSummary = (
  events: Array<RawEngineLocalAppServerAuditEventV1>,
): Array<RawEngineLocalAppServerAuditEventV1> =>
  events.map((event) => rawEngineLocalAppServerAuditEventV1Schema.parse(event));

const dispatchAiSubjectMaskCommand = async ({
  bridge,
  command,
  requestId,
}: {
  bridge: RawEngineLocalAppServerBridge;
  command: AiToolCommandEnvelopeV1;
  requestId: string;
}): Promise<{ ok: true; result: AiToolDryRunResultV1 | AiToolApplyResultV1 } | { ok: false; message: string }> => {
  const dispatchResult = await bridge.dispatch(command, { now: () => new Date(), requestId });
  if (!dispatchResult.ok) {
    return { ok: false, message: dispatchResult.message };
  }

  if (command.dryRun) {
    return { ok: true, result: aiToolDryRunResultV1Schema.parse(dispatchResult.result) };
  }

  return { ok: true, result: aiToolApplyResultV1Schema.parse(dispatchResult.result) };
};

export const runAiSubjectMaskAppServerTool = async (
  request: AiSubjectMaskToolRequest,
): Promise<AiSubjectMaskToolResult> => {
  const parsedRequest = aiSubjectMaskToolRequestSchema.parse(request);
  const { availableProviderIds, provider, snapshot, sourceContentHash } =
    buildAiSubjectMaskCommandContext(parsedRequest);
  const bridge = createRawEngineLocalAppServerBridge({ availableAiProviderIds: availableProviderIds });
  const dryRunCommand = buildAiSubjectMaskCommand({
    approval: {
      approvalClass: ApprovalClass.ExternalModel,
      reason: 'Preview the AI subject-mask plan through the typed dry-run app-server tool.',
      state: 'not_required',
    },
    commandId: `${parsedRequest.operationId}_dry_run`,
    commandType: 'ai.mask.generateSubject',
    dryRun: true,
    expectedGraphRevision: snapshot.graphRevision,
    parameters: buildCommandParameters({
      maskName: parsedRequest.maskName,
      providerClass: parsedRequest.providerClass,
      providerId: parsedRequest.providerId,
      sourceContentHash,
    }),
    request: parsedRequest,
  });
  const dryRunDispatch = await dispatchAiSubjectMaskCommand({
    bridge,
    command: dryRunCommand,
    requestId: parsedRequest.requestId,
  });
  if (!dryRunDispatch.ok) {
    return aiSubjectMaskToolBlockedResultSchema.parse({
      auditEvents: buildAuditEventSummary(bridge.listAuditEvents()),
      provider,
      status: 'blocked',
      userVisibleMessage: dryRunDispatch.message,
    });
  }

  const dryRunResult = aiToolDryRunResultV1Schema.parse(dryRunDispatch.result);
  const applyCommand = buildAiSubjectMaskCommand({
    approval: {
      approvalClass: ApprovalClass.GenerativeEdit,
      reason: 'Apply the accepted AI subject-mask dry-run plan through the typed app-server tool.',
      state: 'approved',
    },
    commandId: `${parsedRequest.operationId}_apply`,
    commandType: 'ai.mask.applySubject',
    dryRun: false,
    expectedGraphRevision: snapshot.graphRevision,
    parameters: {
      ...buildCommandParameters({
        maskName: parsedRequest.maskName,
        providerClass: parsedRequest.providerClass,
        providerId: parsedRequest.providerId,
        sourceContentHash,
      }),
      acceptedDryRunPlanHash: dryRunResult.dryRunPlanHash,
      acceptedDryRunPlanId: dryRunResult.dryRunPlanId,
    },
    request: parsedRequest,
  });
  const applyDispatch = await dispatchAiSubjectMaskCommand({
    bridge,
    command: applyCommand,
    requestId: parsedRequest.requestId,
  });
  if (!applyDispatch.ok) {
    return aiSubjectMaskToolBlockedResultSchema.parse({
      auditEvents: buildAuditEventSummary(bridge.listAuditEvents()),
      provider,
      status: 'blocked',
      userVisibleMessage: applyDispatch.message,
    });
  }

  return aiSubjectMaskToolAppliedResultSchema.parse({
    applyResult: applyDispatch.result,
    auditEvents: buildAuditEventSummary(bridge.listAuditEvents()),
    dryRunResult,
    provider,
    status: 'applied',
  });
};
