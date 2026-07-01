import { z } from 'zod';
import type { ExportReceiptOutput } from '../components/ui/ExportImportProperties';

import type { Adjustments } from './adjustments';
import type { ColorStackPreviewExportParityRuntimeProof } from './colorStackPreviewExportParityRuntime';
import { DEFAULT_SELECTIVE_COLOR_RANGE_CONTROLS, SELECTIVE_COLOR_RANGE_KEYS } from './selectiveColorRanges';

const hashString = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
};

type StableJsonValue =
  | boolean
  | null
  | number
  | string
  | ReadonlyArray<StableJsonValue>
  | { readonly [key: string]: StableJsonValue };

const toStableJsonValue = (value: unknown): StableJsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map(toStableJsonValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, child]) => [key, toStableJsonValue(child)]),
    );
  }
  return null;
};

const stableJson = (value: unknown): string => JSON.stringify(toStableJsonValue(value));

const stringOrNullSchema = z.string().trim().min(1).nullable();
const stableHashSchema = z.string().regex(/^(fnv1a32:[0-9a-f]{8}|sha256:[0-9a-f]{64})$/u);

const runtimeProofSchema = z
  .object({
    baselinePreviewChangedPixelRatio: z.number().min(0).max(1),
    diagnostics: z
      .object({
        failureDomain: z.enum(['export', 'metadata', 'none', 'preview']),
        messages: z.array(z.string().trim().min(1)),
      })
      .strict(),
    exportHash: stableHashSchema,
    exportPath: z.literal('export'),
    maxRgb8MeanAbsDelta: z.number().min(0),
    meanRgb8AbsDelta: z.number().min(0),
    previewHash: stableHashSchema,
    previewPath: z.literal('preview'),
    renderer: z.literal('color_stack_runtime_v1'),
    sourceHash: stableHashSchema,
    sourcePixelCount: z.number().int().positive(),
    stageOrder: z
      .array(
        z.enum([
          'profile_tone',
          'color_style_preset',
          'hsl_selective_color',
          'skin_tone_uniformity',
          'color_balance_rgb',
          'channel_mixer',
          'black_white_mixer',
          'color_grading',
        ]),
      )
      .min(1),
    status: z.enum(['failed', 'passed']),
    tolerance: z
      .object({
        maxRgb8MeanAbsDelta: z.number().min(0),
        metric: z.literal('mean_abs_delta_rgb8'),
      })
      .strict(),
  })
  .strict();

export const colorStackPreviewExportParityReceiptV1Schema = z
  .object({
    activeColorStackHash: z.string().regex(/^fnv1a32:[0-9a-f]{8}$/u),
    colorStylePresetId: stringOrNullSchema,
    components: z
      .object({
        blackWhiteMixerEnabled: z.boolean(),
        cameraProfile: z.string().trim().min(1),
        channelMixerEnabled: z.boolean(),
        colorBalanceRgbEnabled: z.boolean(),
        colorGradingEnabled: z.boolean(),
        selectiveColorRangeCount: z.number().int().nonnegative(),
        selectiveColorRanges: z.array(z.string().trim().min(1)),
        skinToneUniformityEnabled: z.boolean(),
        toneCurve: z.string().trim().min(1),
      })
      .strict(),
    colorManagement: z
      .object({
        cmm: stringOrNullSchema,
        displayProfile: z.literal('editor-preview-srgb'),
        exportProfile: stringOrNullSchema,
        exportRenderingIntent: stringOrNullSchema,
        gamutWarnings: z.array(
          z.enum(['profile_mismatch', 'rendering_intent_mismatch', 'soft_proof_inactive', 'transform_not_applied']),
        ),
        previewProfile: stringOrNullSchema,
        previewRenderingIntent: stringOrNullSchema,
        workingProfile: z.literal('rawengine-linear-rgb'),
      })
      .strict(),
    diagnostics: z
      .object({
        failureDomain: z.enum(['export', 'metadata', 'none', 'preview']),
        messages: z.array(z.string().trim().min(1)),
      })
      .strict(),
    export: z
      .object({
        effectiveColorProfile: stringOrNullSchema,
        effectiveRenderingIntent: stringOrNullSchema,
        outputPath: z.string().trim().min(1),
        requestedColorProfile: stringOrNullSchema,
        requestedRenderingIntent: stringOrNullSchema,
        transformApplied: z.boolean().nullable(),
      })
      .strict(),
    mismatches: z.array(z.enum(['profile', 'rendering_intent', 'soft_proof_inactive'])),
    preview: z
      .object({
        colorProfile: stringOrNullSchema,
        renderingIntent: stringOrNullSchema,
        softProofActive: z.boolean(),
      })
      .strict(),
    runtimeProof: runtimeProofSchema.nullable(),
    schemaVersion: z.literal(1),
    status: z.enum(['failed', 'matched', 'warning']),
    tolerance: z
      .object({
        maxRgb8MeanAbsDelta: z.number().min(0),
        metric: z.enum(['exact_rgb8_hash_match', 'mean_abs_delta_rgb8']),
      })
      .strict(),
  })
  .strict();

export type ColorStackPreviewExportParityReceiptV1 = z.infer<typeof colorStackPreviewExportParityReceiptV1Schema>;

interface ExportSoftProofTransformSummary {
  effectiveColorProfile?: string | null;
  effectiveRenderingIntent?: string | null;
}

export interface BuildColorStackPreviewExportParityReceiptOptions {
  adjustments: Pick<
    Adjustments,
    | 'blackWhiteMixer'
    | 'cameraProfile'
    | 'channelMixer'
    | 'colorBalanceRgb'
    | 'colorGrading'
    | 'hsl'
    | 'selectiveColorRangeControls'
    | 'skinToneUniformity'
    | 'toneCurve'
  >;
  colorStylePresetId?: string | null;
  exportOutput: ExportReceiptOutput;
  exportSoftProofTransform: ExportSoftProofTransformSummary | null;
  isExportSoftProofEnabled: boolean;
  runtimeProof?: ColorStackPreviewExportParityRuntimeProof | null;
}

export function buildColorStackPreviewExportParityReceipt(
  options: BuildColorStackPreviewExportParityReceiptOptions,
): ColorStackPreviewExportParityReceiptV1 {
  const selectiveColorRanges = SELECTIVE_COLOR_RANGE_KEYS.filter((rangeKey) => {
    const controls = options.adjustments.selectiveColorRangeControls[rangeKey];
    const defaults = DEFAULT_SELECTIVE_COLOR_RANGE_CONTROLS[rangeKey];
    return (
      controls.centerHueDegrees !== defaults.centerHueDegrees ||
      controls.widthDegrees !== defaults.widthDegrees ||
      controls.falloffSmoothness !== defaults.falloffSmoothness
    );
  });
  const activeColorStackHash = hashString(
    stableJson({
      blackWhiteMixer: options.adjustments.blackWhiteMixer,
      cameraProfile: options.adjustments.cameraProfile,
      channelMixer: options.adjustments.channelMixer,
      colorBalanceRgb: options.adjustments.colorBalanceRgb,
      colorGrading: options.adjustments.colorGrading,
      colorStylePresetId: options.colorStylePresetId ?? null,
      hsl: options.adjustments.hsl,
      selectiveColorRangeControls: options.adjustments.selectiveColorRangeControls,
      skinToneUniformity: options.adjustments.skinToneUniformity,
      toneCurve: options.adjustments.toneCurve,
    }),
  );
  const previewColorProfile = options.exportSoftProofTransform?.effectiveColorProfile ?? null;
  const previewRenderingIntent = options.exportSoftProofTransform?.effectiveRenderingIntent ?? null;
  const exportColorProfile = options.exportOutput.effectiveColorProfile ?? options.exportOutput.colorProfile ?? null;
  const exportRenderingIntent =
    options.exportOutput.effectiveRenderingIntent ?? options.exportOutput.renderingIntent ?? null;
  const mismatches: ColorStackPreviewExportParityReceiptV1['mismatches'] = [];
  const gamutWarnings: ColorStackPreviewExportParityReceiptV1['colorManagement']['gamutWarnings'] = [];

  if (!options.isExportSoftProofEnabled || options.exportSoftProofTransform === null) {
    mismatches.push('soft_proof_inactive');
    gamutWarnings.push('soft_proof_inactive');
  }
  if (previewColorProfile !== null && exportColorProfile !== null && previewColorProfile !== exportColorProfile) {
    mismatches.push('profile');
    gamutWarnings.push('profile_mismatch');
  }
  if (
    previewRenderingIntent !== null &&
    exportRenderingIntent !== null &&
    previewRenderingIntent !== exportRenderingIntent
  ) {
    mismatches.push('rendering_intent');
    gamutWarnings.push('rendering_intent_mismatch');
  }
  if (options.exportOutput.transformApplied === false) {
    gamutWarnings.push('transform_not_applied');
  }

  const runtimeProof = options.runtimeProof ?? null;
  const diagnostics = buildDiagnostics({ mismatches, runtimeProof });
  const status =
    runtimeProof?.status === 'failed'
      ? 'failed'
      : mismatches.length === 0 && diagnostics.messages.length === 0
        ? 'matched'
        : 'warning';

  return colorStackPreviewExportParityReceiptV1Schema.parse({
    activeColorStackHash,
    colorStylePresetId: options.colorStylePresetId ?? null,
    components: {
      blackWhiteMixerEnabled: options.adjustments.blackWhiteMixer.enabled,
      cameraProfile: options.adjustments.cameraProfile,
      channelMixerEnabled: options.adjustments.channelMixer.enabled,
      colorBalanceRgbEnabled: options.adjustments.colorBalanceRgb.enabled,
      colorGradingEnabled: hasActiveColorGrading(options.adjustments.colorGrading),
      selectiveColorRangeCount: selectiveColorRanges.length,
      selectiveColorRanges,
      skinToneUniformityEnabled: options.adjustments.skinToneUniformity.enabled,
      toneCurve: options.adjustments.toneCurve,
    },
    colorManagement: {
      cmm: options.exportOutput.cmm ?? null,
      displayProfile: 'editor-preview-srgb',
      exportProfile: exportColorProfile,
      exportRenderingIntent,
      gamutWarnings: [...new Set(gamutWarnings)],
      previewProfile: previewColorProfile,
      previewRenderingIntent,
      workingProfile: 'rawengine-linear-rgb',
    },
    diagnostics,
    export: {
      effectiveColorProfile: exportColorProfile,
      effectiveRenderingIntent: exportRenderingIntent,
      outputPath: options.exportOutput.outputPath,
      requestedColorProfile: options.exportOutput.requestedColorProfile ?? null,
      requestedRenderingIntent: options.exportOutput.requestedRenderingIntent ?? null,
      transformApplied: options.exportOutput.transformApplied ?? null,
    },
    mismatches,
    preview: {
      colorProfile: previewColorProfile,
      renderingIntent: previewRenderingIntent,
      softProofActive: options.isExportSoftProofEnabled && options.exportSoftProofTransform !== null,
    },
    runtimeProof,
    schemaVersion: 1,
    status,
    tolerance: {
      maxRgb8MeanAbsDelta: runtimeProof?.tolerance.maxRgb8MeanAbsDelta ?? 0,
      metric: runtimeProof?.tolerance.metric ?? 'exact_rgb8_hash_match',
    },
  });
}

function hasActiveColorGrading(colorGrading: Pick<Adjustments, 'colorGrading'>['colorGrading']): boolean {
  return [colorGrading.global, colorGrading.highlights, colorGrading.midtones, colorGrading.shadows].some(
    (wheel) => wheel.saturation !== 0 || wheel.luminance !== 0,
  );
}

function buildDiagnostics({
  mismatches,
  runtimeProof,
}: {
  mismatches: ColorStackPreviewExportParityReceiptV1['mismatches'];
  runtimeProof: ColorStackPreviewExportParityRuntimeProof | null;
}): ColorStackPreviewExportParityReceiptV1['diagnostics'] {
  const messages = [...(runtimeProof?.diagnostics.messages ?? [])];
  if (mismatches.includes('soft_proof_inactive')) {
    messages.push('Preview soft proof is inactive, so preview/export color-management parity is metadata-only.');
  }
  if (mismatches.includes('profile')) {
    messages.push('Preview and export effective color profiles differ.');
  }
  if (mismatches.includes('rendering_intent')) {
    messages.push('Preview and export rendering intents differ.');
  }

  return {
    failureDomain:
      runtimeProof?.diagnostics.failureDomain !== undefined && runtimeProof.diagnostics.failureDomain !== 'none'
        ? runtimeProof.diagnostics.failureDomain
        : mismatches.length > 0
          ? 'metadata'
          : 'none',
    messages,
  };
}
