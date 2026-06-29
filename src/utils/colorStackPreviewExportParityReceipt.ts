import { z } from 'zod';

import { DEFAULT_SELECTIVE_COLOR_RANGE_CONTROLS, SELECTIVE_COLOR_RANGE_KEYS } from './selectiveColorRanges';

import type { Adjustments } from './adjustments';
import type { ExportReceiptOutput } from '../components/ui/ExportImportProperties';

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

export const colorStackPreviewExportParityReceiptV1Schema = z
  .object({
    activeColorStackHash: z.string().regex(/^fnv1a32:[0-9a-f]{8}$/u),
    colorStylePresetId: stringOrNullSchema,
    components: z
      .object({
        cameraProfile: z.string().trim().min(1),
        selectiveColorRangeCount: z.number().int().nonnegative(),
        selectiveColorRanges: z.array(z.string().trim().min(1)),
        skinToneUniformityEnabled: z.boolean(),
        toneCurve: z.string().trim().min(1),
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
    schemaVersion: z.literal(1),
    status: z.enum(['matched', 'warning']),
    tolerance: z
      .object({
        maxRgb8MeanAbsDelta: z.literal(0),
        metric: z.literal('exact_rgb8_hash_match'),
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
    'cameraProfile' | 'hsl' | 'selectiveColorRangeControls' | 'skinToneUniformity' | 'toneCurve'
  >;
  colorStylePresetId?: string | null;
  exportOutput: ExportReceiptOutput;
  exportSoftProofTransform: ExportSoftProofTransformSummary | null;
  isExportSoftProofEnabled: boolean;
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
      cameraProfile: options.adjustments.cameraProfile,
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

  if (!options.isExportSoftProofEnabled || options.exportSoftProofTransform === null) {
    mismatches.push('soft_proof_inactive');
  }
  if (previewColorProfile !== null && exportColorProfile !== null && previewColorProfile !== exportColorProfile) {
    mismatches.push('profile');
  }
  if (
    previewRenderingIntent !== null &&
    exportRenderingIntent !== null &&
    previewRenderingIntent !== exportRenderingIntent
  ) {
    mismatches.push('rendering_intent');
  }

  return colorStackPreviewExportParityReceiptV1Schema.parse({
    activeColorStackHash,
    colorStylePresetId: options.colorStylePresetId ?? null,
    components: {
      cameraProfile: options.adjustments.cameraProfile,
      selectiveColorRangeCount: selectiveColorRanges.length,
      selectiveColorRanges,
      skinToneUniformityEnabled: options.adjustments.skinToneUniformity.enabled,
      toneCurve: options.adjustments.toneCurve,
    },
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
    schemaVersion: 1,
    status: mismatches.length === 0 ? 'matched' : 'warning',
    tolerance: {
      maxRgb8MeanAbsDelta: 0,
      metric: 'exact_rgb8_hash_match',
    },
  });
}
