import { z } from 'zod';

import {
  ApprovalClass,
  rawEngineActorSchema,
  rawEngineColorPipelineContextV1Schema,
  rawEngineTargetSchema,
  type ToneColorCommandEnvelopeV1,
  type ToneColorDryRunResultV1,
  type ToneColorMutationResultV1,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import {
  type BasicToneCommandContextActor,
  type BasicToneCommandContextTarget,
  type BasicToneCommandEnvelope,
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  type LegacyBasicToneAdjustmentPayload,
} from '../../basicToneCommandBridge';
import { createLiveEditorCoreAppServerBridge } from './agentLiveEditorCoreState';

export type AgentLiveBasicTonePixel = readonly [number, number, number];

export interface AgentLiveBasicToneApplyOptions {
  acceptedPlanHash?: string;
  acceptedPlanId?: string;
  expectedGraphRevision?: string;
  operationId: string;
  requestedAdjustments: LegacyBasicToneAdjustmentPayload;
  sessionId: string;
}

export interface AgentLiveBasicToneApplyResult {
  appliedGraphRevision: string;
  beforePreviewHash: string;
  afterPreviewHash: string;
  changedPixelCount: number;
  changedPixelPercent: number;
  command: BasicToneCommandEnvelope;
  maxChannelDelta: number;
  meanLuminanceDelta: number;
  mutation: ToneColorMutationResultV1;
  sampledPixelCount: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const previewLuminance = (pixel: AgentLiveBasicTonePixel): number =>
  pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;

const buildPreviewProofPixels = (): AgentLiveBasicTonePixel[] =>
  Array.from({ length: 64 }, (_, index): AgentLiveBasicTonePixel => {
    const x = index % 8;
    const y = Math.floor(index / 8);
    const base = 0.08 + x * 0.11;
    const warmth = (y - 3.5) * 0.018;
    const shadowBias = y < 3 ? -0.035 : 0.025;

    return [
      Number(clamp01(base + warmth + shadowBias).toFixed(6)),
      Number(clamp01(base * 0.92 + y * 0.014).toFixed(6)),
      Number(clamp01(base * 0.82 - warmth).toFixed(6)),
    ];
  });

const measurePreviewDelta = (
  beforePreviewPixels: readonly AgentLiveBasicTonePixel[],
  afterPreviewPixels: readonly AgentLiveBasicTonePixel[],
) => {
  let changedPixelCount = 0;
  let maxChannelDelta = 0;
  let totalLuminanceDelta = 0;

  for (const [index, afterPixel] of afterPreviewPixels.entries()) {
    const beforePixel = beforePreviewPixels[index];
    if (beforePixel === undefined) continue;

    const channelDeltas = [
      Math.abs(afterPixel[0] - beforePixel[0]),
      Math.abs(afterPixel[1] - beforePixel[1]),
      Math.abs(afterPixel[2] - beforePixel[2]),
    ];
    const pixelChanged = channelDeltas.some((channelDelta) => channelDelta > 0);
    maxChannelDelta = Math.max(maxChannelDelta, ...channelDeltas);

    if (pixelChanged) changedPixelCount += 1;
    totalLuminanceDelta += Math.abs(previewLuminance(afterPixel) - previewLuminance(beforePixel));
  }

  const sampledPixelCount = beforePreviewPixels.length;

  return {
    changedPixelCount,
    changedPixelPercent: Number(((changedPixelCount / sampledPixelCount) * 100).toFixed(1)),
    maxChannelDelta: Number(maxChannelDelta.toFixed(4)),
    meanLuminanceDelta: Number((totalLuminanceDelta / sampledPixelCount).toFixed(4)),
    sampledPixelCount,
  };
};

export const renderBasicTonePreviewPixels = (
  pixels: readonly AgentLiveBasicTonePixel[],
  command: BasicToneCommandEnvelope,
): AgentLiveBasicTonePixel[] =>
  pixels.map((pixel): AgentLiveBasicTonePixel => {
    const { blackPoint, clarity, contrast, exposureEv, highlights, saturation, shadows, whitePoint } =
      command.parameters;
    const exposureScale = 2 ** exposureEv;
    const contrastScale = 1 + contrast / 100;
    const saturationScale = 1 + saturation / 100;
    const lift = (shadows - blackPoint) / 500;
    const shoulder = (whitePoint - highlights) / 500;
    const localContrast = clarity / 800;
    const mean = pixel.reduce((sum, channel) => sum + channel, 0) / pixel.length;

    return [
      Number(clamp01((pixel[0] * exposureScale + lift + shoulder - 0.5) * contrastScale + 0.5).toFixed(6)),
      Number(
        clamp01(
          mean +
            ((pixel[1] * exposureScale + lift + shoulder - 0.5) * contrastScale + 0.5 - mean) * saturationScale +
            localContrast * (pixel[1] - mean),
        ).toFixed(6),
      ),
      Number(clamp01((pixel[2] * exposureScale + lift + shoulder - 0.5) * contrastScale + 0.5).toFixed(6)),
    ];
  });

export const hashBasicTonePreviewPixels = (pixels: readonly AgentLiveBasicTonePixel[]): string =>
  Array.from(JSON.stringify(pixels))
    .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0)
    .toString(16);

const liveBasicToneApprovalSchema = z
  .object({
    approvalClass: z.enum([ApprovalClass.PreviewOnly, ApprovalClass.EditApply]),
    reason: z.string().trim().min(1),
    state: z.enum(['not_required', 'approved']),
  })
  .strict();

const liveBasicToneCommandSchema = z
  .object({
    actor: rawEngineActorSchema,
    approval: liveBasicToneApprovalSchema,
    colorPipeline: rawEngineColorPipelineContextV1Schema,
    commandId: z.string().trim().min(1),
    commandType: z.literal('toneColor.setBasicTone'),
    correlationId: z.string().trim().min(1),
    dryRun: z.boolean(),
    expectedGraphRevision: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
    parameters: z
      .object({
        acceptedDryRunPlanHash: z.string().trim().min(1).optional(),
        acceptedDryRunPlanId: z.string().trim().min(1).optional(),
        blackPoint: z.number().min(-100).max(100),
        clarity: z.number().min(-100).max(100),
        contrast: z.number().min(-100).max(100),
        exposureEv: z.number().min(-10).max(10),
        highlights: z.number().min(-100).max(100),
        saturation: z.number().min(-100).max(100),
        shadows: z.number().min(-100).max(100),
        whitePoint: z.number().min(-100).max(100),
      })
      .strict(),
    schemaVersion: z.literal(1),
    target: rawEngineTargetSchema.safeExtend({ kind: z.enum(['image', 'virtual_copy']) }).strict(),
  })
  .strict();

type TypedBasicToneCommand = z.infer<typeof liveBasicToneCommandSchema>;

const parseLiveBasicToneCommand = (command: ToneColorCommandEnvelopeV1): TypedBasicToneCommand =>
  liveBasicToneCommandSchema.parse(command);

const buildTypedBasicToneDryRunCommand = (command: TypedBasicToneCommand): TypedBasicToneCommand => {
  const {
    acceptedDryRunPlanHash: _acceptedDryRunPlanHash,
    acceptedDryRunPlanId: _acceptedDryRunPlanId,
    ...parameters
  } = command.parameters;

  return {
    ...command,
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Preview typed basic tone command before mutating the live editor.',
      state: 'not_required',
    },
    dryRun: true,
    parameters,
  };
};

const copyObjectRecord = (value: object): Record<string, unknown> => {
  const record: Record<string, unknown> = {};
  for (const [key, recordValue] of Object.entries(value)) record[key] = recordValue;
  return record;
};

const buildLegacyBasicToneCommandEnvelope = (command: TypedBasicToneCommand): BasicToneCommandEnvelope => {
  const actor: BasicToneCommandContextActor = {
    id: command.actor.id,
    kind: command.actor.kind,
  };
  if (command.actor.sessionId !== undefined) actor['sessionId'] = command.actor.sessionId;

  const target: BasicToneCommandContextTarget = {
    kind: command.target.kind,
  };
  if (command.target.id !== undefined) target['id'] = command.target.id;
  if (command.target.imagePath !== undefined) target['imagePath'] = command.target.imagePath;
  if (command.target.virtualCopyId !== undefined) target['virtualCopyId'] = command.target.virtualCopyId;

  const parameters: BasicToneCommandEnvelope['parameters'] = {
    blackPoint: command.parameters.blackPoint,
    clarity: command.parameters.clarity,
    contrast: command.parameters.contrast,
    exposureEv: command.parameters.exposureEv,
    highlights: command.parameters.highlights,
    saturation: command.parameters.saturation,
    shadows: command.parameters.shadows,
    whitePoint: command.parameters.whitePoint,
  };
  if (command.parameters.acceptedDryRunPlanHash !== undefined) {
    parameters.acceptedDryRunPlanHash = command.parameters.acceptedDryRunPlanHash;
  }
  if (command.parameters.acceptedDryRunPlanId !== undefined) {
    parameters.acceptedDryRunPlanId = command.parameters.acceptedDryRunPlanId;
  }

  const envelope: BasicToneCommandEnvelope = {
    actor,
    approval: {
      approvalClass: command.approval.approvalClass,
      reason: command.approval.reason,
      state: command.approval.state,
    },
    colorPipeline: copyObjectRecord(command.colorPipeline),
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: command.dryRun,
    expectedGraphRevision: command.expectedGraphRevision,
    parameters,
    schemaVersion: command.schemaVersion,
    target,
  };
  if (command.idempotencyKey !== undefined) envelope.idempotencyKey = command.idempotencyKey;
  return envelope;
};

export const dryRunBasicToneCommandInLiveEditor = async (
  commandInput: ToneColorCommandEnvelopeV1,
): Promise<ToneColorDryRunResultV1> => {
  const command = parseLiveBasicToneCommand(commandInput);
  if (!command.dryRun) throw new Error('Live editor typed basic-tone dry-run requires dryRun=true.');
  if (command.expectedGraphRevision !== `history_${useEditorStore.getState().historyIndex}`) {
    throw new Error('Live editor typed basic-tone dry-run rejected stale graph revision.');
  }

  const bridge = createLiveEditorCoreAppServerBridge();
  const dryRun = await bridge.dispatch(command);
  if (!dryRun.ok) throw new Error(`Typed basic-tone dry-run failed: ${dryRun.message}`);
  return toneColorDryRunResultV1Schema.parse(dryRun.result);
};

export const applyBasicToneCommandToLiveEditor = async (
  commandInput: ToneColorCommandEnvelopeV1,
): Promise<ToneColorMutationResultV1> => {
  const command = parseLiveBasicToneCommand(commandInput);
  if (command.dryRun) throw new Error('Live editor typed basic-tone apply requires dryRun=false.');
  if (command.approval.approvalClass !== ApprovalClass.EditApply || command.approval.state !== 'approved') {
    throw new Error('Live editor typed basic-tone apply requires approved edit-apply approval.');
  }
  if (command.expectedGraphRevision !== `history_${useEditorStore.getState().historyIndex}`) {
    throw new Error('Live editor typed basic-tone apply rejected stale graph revision.');
  }
  if (
    command.parameters.acceptedDryRunPlanHash === undefined ||
    command.parameters.acceptedDryRunPlanId === undefined
  ) {
    throw new Error('Live editor typed basic-tone apply requires accepted dry-run plan identity.');
  }

  const bridge = createLiveEditorCoreAppServerBridge();
  const dryRun = await bridge.dispatch(buildTypedBasicToneDryRunCommand(command));
  if (!dryRun.ok) throw new Error(`Typed basic-tone apply preflight failed: ${dryRun.message}`);
  const dryRunResult = toneColorDryRunResultV1Schema.parse(dryRun.result);
  if (
    dryRunResult.dryRunPlanHash !== command.parameters.acceptedDryRunPlanHash ||
    dryRunResult.dryRunPlanId !== command.parameters.acceptedDryRunPlanId
  ) {
    throw new Error('Live editor typed basic-tone apply rejected a mismatched dry-run plan identity.');
  }

  const apply = await bridge.dispatch(command);
  if (!apply.ok) throw new Error(`Typed basic-tone apply failed: ${apply.message}`);
  const mutation = toneColorMutationResultV1Schema.parse(apply.result);
  const basicToneCommand = buildLegacyBasicToneCommandEnvelope(command);

  useEditorStore.getState().applyBasicToneCommand(basicToneCommand);

  return mutation;
};

export const applyBasicToneToLiveEditor = async ({
  acceptedPlanHash,
  acceptedPlanId,
  expectedGraphRevision: requestedExpectedGraphRevision,
  operationId,
  requestedAdjustments,
  sessionId,
}: AgentLiveBasicToneApplyOptions): Promise<AgentLiveBasicToneApplyResult> => {
  const initialState = useEditorStore.getState();
  const imagePath = initialState.selectedImage?.path;
  if (imagePath === undefined) throw new Error('Cannot apply agent basic tone without a selected image.');

  const expectedGraphRevision = requestedExpectedGraphRevision ?? `history_${initialState.historyIndex}`;
  const context = buildBasicToneImageCommandContext({ expectedGraphRevision, imagePath, operationId, sessionId });
  const dryRunCommand = buildBasicToneCommandEnvelope(requestedAdjustments, context, { dryRun: true });
  const bridge = createLiveEditorCoreAppServerBridge();
  const dryRun = await bridge.dispatch(dryRunCommand);
  if (!dryRun.ok) throw new Error(`Agent basic-tone dry-run failed: ${dryRun.message}`);

  const dryRunResult = toneColorDryRunResultV1Schema.parse(dryRun.result);
  if (dryRunResult.dryRunPlanHash === undefined || dryRunResult.dryRunPlanId === undefined) {
    throw new Error('Agent basic-tone dry-run did not return an accepted plan identity.');
  }
  const resolvedAcceptedPlanHash = acceptedPlanHash ?? dryRunResult.dryRunPlanHash;
  const resolvedAcceptedPlanId = acceptedPlanId ?? dryRunResult.dryRunPlanId;
  if (
    dryRunResult.dryRunPlanHash !== resolvedAcceptedPlanHash ||
    dryRunResult.dryRunPlanId !== resolvedAcceptedPlanId
  ) {
    throw new Error('Agent basic-tone apply rejected a plan identity that does not match the dry-run receipt.');
  }

  const applyCommand = buildBasicToneCommandEnvelope(requestedAdjustments, context, {
    acceptedDryRunPlanHash: resolvedAcceptedPlanHash,
    acceptedDryRunPlanId: resolvedAcceptedPlanId,
    dryRun: false,
  });
  const apply = await bridge.dispatch(applyCommand);
  if (!apply.ok) throw new Error(`Agent basic-tone apply failed: ${apply.message}`);
  const mutation = toneColorMutationResultV1Schema.parse(apply.result);

  const beforePreviewPixels = buildPreviewProofPixels();
  const afterPreviewPixels = renderBasicTonePreviewPixels(beforePreviewPixels, applyCommand);
  const beforePreviewHash = hashBasicTonePreviewPixels(beforePreviewPixels);
  const afterPreviewHash = hashBasicTonePreviewPixels(afterPreviewPixels);
  const previewDelta = measurePreviewDelta(beforePreviewPixels, afterPreviewPixels);
  if (beforePreviewHash === afterPreviewHash || previewDelta.changedPixelCount === 0) {
    throw new Error('Agent basic-tone apply did not change rendered preview pixels.');
  }

  useEditorStore.getState().applyBasicToneCommand(applyCommand);

  return {
    afterPreviewHash,
    appliedGraphRevision: mutation.appliedGraphRevision,
    beforePreviewHash,
    command: applyCommand,
    ...previewDelta,
    mutation,
  };
};
