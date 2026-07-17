import { z } from 'zod';
import { type EditDocumentV2, editDocumentLayersV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { Mask, type SubMask, SubMaskMode } from '../../components/panel/right/layers/Masks';
import { INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../adjustments';
import { selectEditDocumentMasks } from '../editDocumentSelectors';
import type { EditTransactionRequest } from '../editTransaction';

/** The three Lightroom-style scene actions intentionally share one authority contract. */
export const lightroomAiSceneMaskCapabilitySchema = z.enum(['subject', 'sky', 'background']);
export type LightroomAiSceneMaskCapability = z.infer<typeof lightroomAiSceneMaskCapabilitySchema>;

export const lightroomAiSceneMaskStatusSchema = z.enum([
  'idle',
  'queued',
  'running',
  'preview',
  'current',
  'failed',
  'cancelled',
  'unavailable',
]);
export type LightroomAiSceneMaskStatus = z.infer<typeof lightroomAiSceneMaskStatusSchema>;

export const lightroomAiSceneMaskAuthoritySchema = z
  .object({
    cancellationToken: z.string().min(1),
    imageSessionId: z.string().min(1),
    modelVersion: z.string().min(1),
    providerId: z.string().min(1),
    renderRevision: z.number().int().nonnegative(),
    requestId: z.string().min(1),
    sourceAssetIdentity: z.string().min(1),
    sourceGraphRevision: z.string().min(1),
    capability: lightroomAiSceneMaskCapabilitySchema,
  })
  .strict();
export type LightroomAiSceneMaskAuthority = z.infer<typeof lightroomAiSceneMaskAuthoritySchema>;

export const lightroomAiSceneMaskResultSchema = z
  .object({
    authority: lightroomAiSceneMaskAuthoritySchema,
    maskDataBase64: z.string().min(1).nullable().optional(),
    generatedMaskArtifactId: z.string().min(1).nullable().optional(),
    generatedMaskCoverage: z.number().min(0).max(1).nullable().optional(),
    parameters: z.record(z.string(), z.unknown()).default({}),
    previewUrl: z.string().min(1).nullable().optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      (result.maskDataBase64 === undefined || result.maskDataBase64 === null) &&
      (result.generatedMaskArtifactId === undefined || result.generatedMaskArtifactId === null) &&
      (result.generatedMaskCoverage === undefined || result.generatedMaskCoverage === null)
    ) {
      context.addIssue({ code: 'custom', message: 'AI scene mask result has no mask artifact or payload.' });
    }
  });
export type LightroomAiSceneMaskResult = z.infer<typeof lightroomAiSceneMaskResultSchema>;

export interface LightroomAiSceneMaskJob {
  authority: LightroomAiSceneMaskAuthority;
  errorMessage: string | null;
  progress: number;
  result: LightroomAiSceneMaskResult | null;
  status: LightroomAiSceneMaskStatus;
}

export const createLightroomAiSceneMaskAuthority = (input: {
  capability: LightroomAiSceneMaskCapability;
  imageSessionId: string;
  modelVersion?: string;
  providerId: string;
  renderRevision: number;
  requestId: string;
  sourceAssetIdentity: string;
  sourceGraphRevision: string;
  cancellationToken: string;
}): LightroomAiSceneMaskAuthority =>
  lightroomAiSceneMaskAuthoritySchema.parse({
    modelVersion: input.modelVersion ?? 'runtime-v1',
    ...input,
  });

export const createLightroomAiSceneMaskJob = (authority: LightroomAiSceneMaskAuthority): LightroomAiSceneMaskJob => ({
  authority,
  errorMessage: null,
  progress: 0,
  result: null,
  status: 'queued',
});

export const isCurrentLightroomAiSceneMaskAuthority = (
  expected: LightroomAiSceneMaskAuthority,
  actual: LightroomAiSceneMaskAuthority,
): boolean =>
  expected.requestId === actual.requestId &&
  expected.cancellationToken === actual.cancellationToken &&
  expected.capability === actual.capability &&
  expected.imageSessionId === actual.imageSessionId &&
  expected.sourceAssetIdentity === actual.sourceAssetIdentity &&
  expected.sourceGraphRevision === actual.sourceGraphRevision &&
  expected.renderRevision === actual.renderRevision &&
  expected.providerId === actual.providerId &&
  expected.modelVersion === actual.modelVersion;

export const acceptLightroomAiSceneMaskResult = (
  job: LightroomAiSceneMaskJob,
  result: unknown,
): LightroomAiSceneMaskJob | null => {
  if (job.status !== 'queued' && job.status !== 'running') return null;
  const parsed = lightroomAiSceneMaskResultSchema.safeParse(result);
  if (!parsed.success || !isCurrentLightroomAiSceneMaskAuthority(job.authority, parsed.data.authority)) return null;
  return { ...job, errorMessage: null, progress: 1, result: parsed.data, status: 'preview' };
};

export const markLightroomAiSceneMaskRunning = (job: LightroomAiSceneMaskJob): LightroomAiSceneMaskJob =>
  job.status === 'queued' || job.status === 'failed'
    ? { ...job, errorMessage: null, progress: Math.max(job.progress, 0.05), status: 'running' }
    : job;

export const markLightroomAiSceneMaskFailed = (
  job: LightroomAiSceneMaskJob,
  errorMessage: string,
): LightroomAiSceneMaskJob => ({
  ...job,
  errorMessage: errorMessage.trim() || 'Mask generation failed. Try again.',
  status: 'failed',
});

export const markLightroomAiSceneMaskCancelled = (job: LightroomAiSceneMaskJob): LightroomAiSceneMaskJob => ({
  ...job,
  errorMessage: null,
  status: 'cancelled',
});

export const markLightroomAiSceneMaskUnavailable = (
  job: LightroomAiSceneMaskJob,
  message: string,
): LightroomAiSceneMaskJob => ({
  ...job,
  errorMessage: message.trim() || 'This mask provider is unavailable.',
  status: 'unavailable',
});

export const refineLightroomAiSceneMaskResult = (
  job: LightroomAiSceneMaskJob,
  parameters: Record<string, unknown>,
): LightroomAiSceneMaskJob =>
  job.result === null || job.status !== 'preview'
    ? job
    : { ...job, result: { ...job.result, parameters: { ...job.result.parameters, ...parameters } } };

const sceneMaskType = (capability: LightroomAiSceneMaskCapability): Mask => {
  if (capability === 'subject') return Mask.AiSubject;
  return capability === 'sky' ? Mask.AiSky : Mask.AiForeground;
};

export const createLightroomAiSceneMaskContainer = (input: {
  capability: LightroomAiSceneMaskCapability;
  result: LightroomAiSceneMaskResult;
  imageDimensions?: { width: number; height: number };
}): MaskContainer => {
  const id = `ai-${input.capability}-${input.result.authority.requestId}`;
  const type = sceneMaskType(input.capability);
  const isBackground = input.capability === 'background';
  const subMask: SubMask = {
    id: `${id}-component`,
    invert: isBackground,
    mode: SubMaskMode.Additive,
    name: input.capability.charAt(0).toUpperCase() + input.capability.slice(1),
    opacity: 100,
    parameters: {
      ...input.result.parameters,
      ...(input.imageDimensions === undefined
        ? {}
        : { imageWidth: input.imageDimensions.width, imageHeight: input.imageDimensions.height }),
      ...(input.result.maskDataBase64 === undefined ? {} : { maskDataBase64: input.result.maskDataBase64 }),
      ...(input.result.generatedMaskArtifactId === undefined
        ? {}
        : { generatedMaskArtifactId: input.result.generatedMaskArtifactId }),
      ...(input.result.generatedMaskCoverage === undefined
        ? {}
        : { generatedMaskCoverage: input.result.generatedMaskCoverage }),
      rawEngine: {
        capability: input.capability,
        modelVersion: input.result.authority.modelVersion,
        providerId: input.result.authority.providerId,
        requestId: input.result.authority.requestId,
        sourceAssetIdentity: input.result.authority.sourceAssetIdentity,
        sourceGraphRevision: input.result.authority.sourceGraphRevision,
      },
    },
    type,
    visible: true,
  };
  return {
    adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
    blendMode: 'normal',
    id,
    invert: false,
    name: `${subMask.name} mask`,
    opacity: 100,
    editNodes: {
      basic: { enabled: true },
      color: { enabled: true },
      curves: { enabled: true },
      details: { enabled: true },
    },
    editNodeSchemaVersion: 1,
    subMasks: [subMask],
    visible: true,
  } satisfies MaskContainer;
};

/** Build the one authoritative, undoable layer transaction used by Apply. */
export const buildLightroomAiSceneMaskTransaction = (input: {
  document: EditDocumentV2;
  imageSessionId: string;
  baseAdjustmentRevision: number;
  capability: LightroomAiSceneMaskCapability;
  result: LightroomAiSceneMaskResult;
  imageDimensions?: { width: number; height: number };
}): EditTransactionRequest => {
  const masks = [...selectEditDocumentMasks(input.document), createLightroomAiSceneMaskContainer(input)];
  return {
    transactionId: `ai-scene-mask-${input.result.authority.requestId}`,
    imageSessionId: input.imageSessionId,
    baseAdjustmentRevision: input.baseAdjustmentRevision,
    source: 'ai-edit',
    operations: [
      {
        nodeType: 'layers',
        patch: editDocumentLayersV2Schema.parse({ masks }),
        type: 'patch-edit-document-node',
      },
    ],
    history: 'single-entry',
    persistence: 'commit',
  };
};
