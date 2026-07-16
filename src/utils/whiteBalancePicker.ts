import { z } from 'zod';
import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import { cctToXy, type TechnicalWhiteBalance, technicalWhiteBalanceSchema } from './color/whiteBalance';
import { updateEditDocumentV2Node } from './editDocumentV2';
import type { EditTransactionRequest } from './editTransaction';

const whiteBalancePickerSampleSchema = z
  .object({
    red: z.number().min(0).max(255),
    green: z.number().min(0).max(255),
    blue: z.number().min(0).max(255),
  })
  .strict();

export interface WhiteBalancePickerSampleCoordinates {
  imageX: number;
  imageY: number;
  previewPixelX: number;
  previewPixelY: number;
}

export interface WhiteBalancePickerRuntimeReceipt {
  averageRgb: z.infer<typeof whiteBalancePickerSampleSchema>;
  algorithm: 'neutral_patch_scene_linear_chromaticity_v1';
  clippedChannelCount: number;
  confidence: number;
  coordinates: WhiteBalancePickerSampleCoordinates;
  estimatedDuv: number;
  estimatedKelvin: number;
  estimatedXy: [number, number];
  patchPixelCount: number;
  rejectedClippedPixels: number;
  spatialVariance: number;
  previewIdentity: string;
  resultingDuv: number;
  resultingKelvin: number;
  selectedImagePath: string;
}

export interface WhiteBalancePickerAdjustmentCommand {
  patch: {
    whiteBalanceTechnical: TechnicalWhiteBalance;
  };
  receipt: WhiteBalancePickerRuntimeReceipt;
}

export interface WhiteBalancePickerAdjustmentCommandInput {
  averageRgb: z.infer<typeof whiteBalancePickerSampleSchema>;
  coordinates: WhiteBalancePickerSampleCoordinates;
  previewIdentity: string;
  currentPreviewIdentity?: string;
  patchPixelCount?: number;
  rejectedClippedPixels?: number;
  spatialVariance?: number;
  selectedImagePath: string;
}

export interface WhiteBalancePickerPatchSample {
  averageRgb: z.infer<typeof whiteBalancePickerSampleSchema>;
  patchPixelCount: number;
  rejectedClippedPixels: number;
  spatialVariance: number;
}

class WhiteBalancePickerSampleError extends Error {
  constructor(public readonly code: 'stale_preview' | 'clipped_patch' | 'non_uniform_patch') {
    super(`white_balance_picker_${code}`);
  }
}

export interface WhiteBalancePickerPreviewSession {
  baseEditDocumentV2: EditDocumentV2;
  lastPreviewIdentity: string | null;
  previewActive: boolean;
  sourceIdentity: string;
}

export interface WhiteBalancePickerEditTransactionState {
  adjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

export const buildWhiteBalancePickerEditTransaction = (
  state: WhiteBalancePickerEditTransactionState,
  command: WhiteBalancePickerAdjustmentCommand,
  transactionId: string,
): EditTransactionRequest => {
  const { receipt } = command;
  if (state.selectedImage?.path !== receipt.selectedImagePath) {
    throw new Error(
      `white_balance_picker_stale_source:${receipt.selectedImagePath}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    operations: [
      {
        nodeType: 'camera_input',
        patch: { whiteBalanceTechnical: command.patch.whiteBalanceTechnical },
        type: 'patch-edit-document-node',
      },
      ...(state.editDocumentV2.provenance.referenceMatchApplicationReceipt === null
        ? []
        : [{ receipt: null, type: 'set-reference-match-application-receipt' as const }]),
    ],
    persistence: 'commit',
    source: 'picker',
    transactionId,
  };
};

export const createWhiteBalancePickerPreviewSession = (
  baseEditDocumentV2: EditDocumentV2,
  sourceIdentity: string,
): WhiteBalancePickerPreviewSession => ({
  baseEditDocumentV2: structuredClone(baseEditDocumentV2),
  lastPreviewIdentity: null,
  previewActive: false,
  sourceIdentity,
});

export const applyWhiteBalancePickerHoverPreview = (
  session: WhiteBalancePickerPreviewSession,
  command: WhiteBalancePickerAdjustmentCommand,
): { editDocumentV2: EditDocumentV2; session: WhiteBalancePickerPreviewSession } => {
  const { receipt } = command;
  if (session.sourceIdentity !== receipt.selectedImagePath) throw new WhiteBalancePickerSampleError('stale_preview');
  return {
    editDocumentV2: updateEditDocumentV2Node(session.baseEditDocumentV2, 'camera_input', (params) => ({
      ...params,
      whiteBalanceTechnical: command.patch.whiteBalanceTechnical,
    })),
    session: {
      ...session,
      lastPreviewIdentity: receipt.previewIdentity,
      previewActive: true,
    },
  };
};

export const cancelWhiteBalancePickerPreview = (
  session: WhiteBalancePickerPreviewSession,
  currentSourceIdentity: string,
): EditDocumentV2 => {
  if (session.sourceIdentity !== currentSourceIdentity) throw new WhiteBalancePickerSampleError('stale_preview');
  return structuredClone(session.baseEditDocumentV2);
};

const srgbToLinear = (value: number): number => {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

const xyToUv = ([x, y]: readonly number[]): [number, number] => {
  const denominator = -2 * (x ?? 0) + 12 * (y ?? 0) + 3;
  return [(4 * (x ?? 0)) / denominator, (6 * (y ?? 0)) / denominator];
};

export const estimateNeutralSampleIlluminant = (sample: z.infer<typeof whiteBalancePickerSampleSchema>) => {
  const parsed = whiteBalancePickerSampleSchema.parse(sample);
  const red = srgbToLinear(parsed.red);
  const green = srgbToLinear(parsed.green);
  const blue = srgbToLinear(parsed.blue);
  const xyz: [number, number, number] = [
    0.4124564 * red + 0.3575761 * green + 0.1804375 * blue,
    0.2126729 * red + 0.7151522 * green + 0.072175 * blue,
    0.0193339 * red + 0.119192 * green + 0.9503041 * blue,
  ];
  const sum = xyz[0] + xyz[1] + xyz[2];
  const xy: [number, number] = sum > 1e-9 ? [xyz[0] / sum, xyz[1] / sum] : [0.32168, 0.33767];
  const uv = xyToUv(xy);
  let nearestKelvin = 6504;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestUv: [number, number] = xyToUv(cctToXy(nearestKelvin));
  for (let kelvin = 1667; kelvin <= 25000; kelvin += kelvin < 5000 ? 10 : 25) {
    const candidateUv = xyToUv(cctToXy(kelvin));
    const distance = Math.hypot(uv[0] - candidateUv[0], uv[1] - candidateUv[1]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestKelvin = kelvin;
      nearestUv = candidateUv;
    }
  }
  const chroma = Math.max(parsed.red, parsed.green, parsed.blue) - Math.min(parsed.red, parsed.green, parsed.blue);
  const clippedChannelCount = [parsed.red, parsed.green, parsed.blue].filter(
    (value) => value <= 1 || value >= 254,
  ).length;
  return {
    xy,
    kelvin: nearestKelvin,
    duv: Math.min(0.05, Math.max(-0.05, Math.sign(uv[1] - nearestUv[1]) * nearestDistance)),
    clippedChannelCount,
    confidence: Math.max(0, Math.min(1, (1 - clippedChannelCount / 3) * (1 - chroma / 255))),
  };
};

export const averageWhiteBalancePickerRgbaSample = (
  data: Uint8ClampedArray | ArrayLike<number>,
): z.infer<typeof whiteBalancePickerSampleSchema> | null => {
  if (data.length < 4) return null;

  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    redTotal += data[i] ?? 0;
    greenTotal += data[i + 1] ?? 0;
    blueTotal += data[i + 2] ?? 0;
    count += 1;
  }

  if (count === 0) return null;

  return whiteBalancePickerSampleSchema.parse({
    red: redTotal / count,
    green: greenTotal / count,
    blue: blueTotal / count,
  });
};

export const analyzeWhiteBalancePickerRgbaSample = (
  data: Uint8ClampedArray | ArrayLike<number>,
): WhiteBalancePickerPatchSample | null => {
  const averageRgb = averageWhiteBalancePickerRgbaSample(data);
  if (!averageRgb) return null;
  const patchPixelCount = Math.floor(data.length / 4);
  let rejectedClippedPixels = 0;
  let squaredDistance = 0;
  for (let i = 0; i + 2 < data.length; i += 4) {
    const red = data[i] ?? 0;
    const green = data[i + 1] ?? 0;
    const blue = data[i + 2] ?? 0;
    if (Math.min(red, green, blue) <= 1 || Math.max(red, green, blue) >= 254) rejectedClippedPixels += 1;
    squaredDistance += (red - averageRgb.red) ** 2 + (green - averageRgb.green) ** 2 + (blue - averageRgb.blue) ** 2;
  }
  return {
    averageRgb,
    patchPixelCount,
    rejectedClippedPixels,
    spatialVariance: squaredDistance / Math.max(1, patchPixelCount * 3 * 255 ** 2),
  };
};

export const buildWhiteBalancePickerAdjustmentCommand = ({
  averageRgb,
  coordinates,
  patchPixelCount = 1,
  previewIdentity,
  currentPreviewIdentity = previewIdentity,
  rejectedClippedPixels = 0,
  selectedImagePath,
  spatialVariance = 0,
}: WhiteBalancePickerAdjustmentCommandInput): WhiteBalancePickerAdjustmentCommand => {
  if (currentPreviewIdentity !== previewIdentity) throw new WhiteBalancePickerSampleError('stale_preview');
  if (patchPixelCount <= 0 || rejectedClippedPixels / patchPixelCount > 0.1)
    throw new WhiteBalancePickerSampleError('clipped_patch');
  if (spatialVariance > 0.025) throw new WhiteBalancePickerSampleError('non_uniform_patch');
  const estimate = estimateNeutralSampleIlluminant(averageRgb);
  const patch = {
    whiteBalanceTechnical: technicalWhiteBalanceSchema.parse({
      adaptation: 'cat16_v1',
      confidence: estimate.confidence,
      contract: 'rapidraw.white_balance.v1',
      duv: estimate.duv,
      inputSemantics: 'raw_scene_linear',
      kelvin: estimate.kelvin,
      mode: 'chromaticity',
      presetId: null,
      sampleCount: patchPixelCount - rejectedClippedPixels,
      source: 'picker',
      synchronization: { mode: 'per_image', referenceSourceIdentity: null },
      x: estimate.xy[0],
      y: estimate.xy[1],
    }),
  };

  return {
    patch,
    receipt: {
      averageRgb: whiteBalancePickerSampleSchema.parse(averageRgb),
      algorithm: 'neutral_patch_scene_linear_chromaticity_v1',
      clippedChannelCount: estimate.clippedChannelCount,
      confidence: estimate.confidence,
      coordinates,
      estimatedDuv: estimate.duv,
      estimatedKelvin: estimate.kelvin,
      estimatedXy: estimate.xy,
      patchPixelCount,
      previewIdentity,
      rejectedClippedPixels,
      resultingDuv: estimate.duv,
      resultingKelvin: estimate.kelvin,
      selectedImagePath,
      spatialVariance,
    },
  };
};

export const applyWhiteBalancePickerAdjustmentCommand = (
  baseEditDocumentV2: EditDocumentV2,
  command: WhiteBalancePickerAdjustmentCommand,
): EditDocumentV2 =>
  updateEditDocumentV2Node(baseEditDocumentV2, 'camera_input', (params) => ({
    ...params,
    whiteBalanceTechnical: command.patch.whiteBalanceTechnical,
  }));
