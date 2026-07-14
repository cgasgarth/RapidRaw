import { z } from 'zod';

import {
  type NegativeLabAppServerRuntimeDryRunToolResultV1,
  NegativeLabAppServerRuntimeToolBusV1,
  type NegativeLabCommandEnvelopeV1,
  type NegativeLabRuntimePreviewRenderResultV1,
} from '../../../packages/rawengine-schema/src';
import type { NegativeLabCrosstalkProfile } from '../../schemas/negative-lab/negativeLabCrosstalkProfileSchemas';
import { negativeLabStagePreviewArtifactFieldsSchema } from '../../schemas/negative-lab/negativeLabStagePreviewSchemas';
import { Invokes } from '../../tauri/commands';
import { invokeWithSchema } from '../tauriSchemaInvoke';
import {
  NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME,
  NEGATIVE_LAB_AGENT_TOOL_MANIFEST,
} from './app-server/negativeLabAgentAppServerToolDispatch';

const nativeDensityAxisBoundsSchema = z.object({ max: z.number(), min: z.number() }).strict();
const nativeDensityBoundsSetSchema = z
  .object({
    axisBounds: z.object({ color: nativeDensityAxisBoundsSchema, luma: nativeDensityAxisBoundsSchema }).strict(),
    channelBounds: z
      .object({ b: nativeDensityAxisBoundsSchema, g: nativeDensityAxisBoundsSchema, r: nativeDensityAxisBoundsSchema })
      .strict(),
  })
  .strict();
const LEGACY_NATIVE_DENSITY_BOUNDS_RECEIPT = {
  algorithmId: 'fixed_grid_block_median_luma_color_v1',
  analysisBuffer: 0.04,
  analysisRect: { height: 0.92, width: 0.92, x: 0.04, y: 0.04 },
  baseBounds: {
    axisBounds: { color: { max: 0.08, min: -0.08 }, luma: { max: 0.16, min: 0.02 } },
    channelBounds: {
      b: { max: 0.2, min: 0.04 },
      g: { max: 0.16, min: 0.02 },
      r: { max: 0.14, min: 0.01 },
    },
  },
  baseFogProvenance: 'automatic_analysis',
  colorRangeClip: 0.12,
  finalBounds: {
    axisBounds: { color: { max: 0.12, min: -0.12 }, luma: { max: 1.08, min: -0.03 } },
    channelBounds: {
      b: { max: 1.08, min: -0.03 },
      g: { max: 1.02, min: -0.02 },
      r: { max: 0.98, min: -0.01 },
    },
  },
  lumaRangeClip: 0.08,
  schemaVersion: 1,
  warningCodes: ['missing_visible_base'],
} as const;
const nativeDensityBoundsReceiptSchema = z
  .object({
    algorithmId: z.literal('fixed_grid_block_median_luma_color_v1'),
    analysisBuffer: z.number().min(0).max(0.25),
    analysisRect: z
      .object({
        height: z.number().positive(),
        width: z.number().positive(),
        x: z.number().min(0),
        y: z.number().min(0),
      })
      .strict(),
    baseBounds: nativeDensityBoundsSetSchema,
    baseFogProvenance: z.enum(['automatic_analysis', 'manual_base_fog_sample', 'profile_embedded_base_fog_sample']),
    colorRangeClip: z.number().min(0.01).max(0.3),
    finalBounds: nativeDensityBoundsSetSchema,
    lumaRangeClip: z.number().min(0.01).max(0.3),
    schemaVersion: z.literal(1),
    warningCodes: z.array(
      z.enum(['clipped_base_channel', 'low_acquisition_confidence', 'missing_visible_base', 'uneven_illumination']),
    ),
  })
  .strict()
  .default(() => ({
    ...LEGACY_NATIVE_DENSITY_BOUNDS_RECEIPT,
    warningCodes: [...LEGACY_NATIVE_DENSITY_BOUNDS_RECEIPT.warningCodes],
  }));

const nativeDensityScopesSchema = z
  .object({
    algorithmId: z.literal('native_negative_lab_density_scopes_v1'),
    clippedPixelCount: z.number().int().nonnegative(),
    densityHistogram: z
      .object({ bins: z.array(z.number().int().nonnegative()).length(32), max: z.number(), min: z.number() })
      .strict(),
    gamutOutOfRangePixelCount: z.number().int().nonnegative(),
    hAndDCurve: z
      .array(z.object({ inputDensity: z.number(), outputLuma: z.number() }).strict())
      .min(1)
      .max(17),
    outputLumaHistogram: z
      .object({ bins: z.array(z.number().int().nonnegative()).length(32), max: z.number(), min: z.number() })
      .strict(),
    sampleCount: z.number().int().nonnegative(),
    schemaVersion: z.literal(1),
  })
  .strict();

export const negativeLabDryRunPreviewArtifactSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    baseFogSampleSummary: z
      .object({
        clippedFraction: z.number().min(0).max(1),
        confidence: z.number().min(0).max(1),
        densityRange: z.number().min(0),
        densityRgb: z.object({ b: z.number().min(0), g: z.number().min(0), r: z.number().min(0) }).strict(),
        meanRgb: z
          .object({ b: z.number().min(0).max(1), g: z.number().min(0).max(1), r: z.number().min(0).max(1) })
          .strict(),
        sampleCount: z.number().int().positive(),
        sampleRect: z
          .object({
            height: z.number().min(0.02).max(1),
            width: z.number().min(0.02).max(1),
            x: z.number().min(0).max(0.98),
            y: z.number().min(0).max(0.98),
          })
          .strict(),
        source: z.enum(['requested_base_fog_sample_rect', 'deterministic_edge_safe_default_rect']),
        warningCodes: z.array(
          z.enum(['clipped_base_channel', 'low_acquisition_confidence', 'missing_visible_base', 'uneven_illumination']),
        ),
      })
      .strict(),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    densityNormalizationMetrics: z
      .object({
        axisBounds: z
          .object({
            color: z.object({ max: z.number(), min: z.number() }).strict(),
            luma: z.object({ max: z.number(), min: z.number() }).strict(),
          })
          .strict(),
        channelBounds: z
          .object({
            b: z.object({ max: z.number(), min: z.number() }).strict(),
            g: z.object({ max: z.number(), min: z.number() }).strict(),
            r: z.object({ max: z.number(), min: z.number() }).strict(),
          })
          .strict(),
        boundsReceipt: nativeDensityBoundsReceiptSchema,
        clippedPixelCount: z.number().int().nonnegative(),
        crosstalkReceipt: z
          .object({
            appliedMatrix: z.tuple([
              z.tuple([z.number(), z.number(), z.number()]),
              z.tuple([z.number(), z.number(), z.number()]),
              z.tuple([z.number(), z.number(), z.number()]),
            ]),
            boundsAnalysisIdentity: z.literal('post_crosstalk_density:fixed_grid_block_median_luma_color_v1'),
            conditioning: z.number().positive(),
            postNeutralError: z.number().nonnegative(),
            preNeutralError: z.number().nonnegative(),
            profileId: z.string().trim().min(1),
            provenanceHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
            requestedMatrix: z.tuple([
              z.tuple([z.number(), z.number(), z.number()]),
              z.tuple([z.number(), z.number(), z.number()]),
              z.tuple([z.number(), z.number(), z.number()]),
            ]),
            rowSums: z.tuple([z.number(), z.number(), z.number()]),
            schemaVersion: z.literal(1),
            strength: z.number().min(0).max(1),
          })
          .strict()
          .optional(),
        densityRangeUnclamped: z.number().nonnegative(),
        epsilonClampedPixelCount: z.number().int().nonnegative(),
        rendererVersion: z.number().int().positive(),
      })
      .strict(),
    densityScopes: nativeDensityScopesSchema.optional(),
    dimensions: z
      .object({
        height: z.number().int().positive(),
        width: z.number().int().positive(),
      })
      .strict(),
    previewDataUrl: z.string().startsWith('data:image/jpeg;base64,'),
    stageArtifacts: z
      .array(negativeLabStagePreviewArtifactFieldsSchema.extend({ boundsReceipt: nativeDensityBoundsReceiptSchema }))
      .optional(),
    renderer: z.literal('rawengine_negative_lab_runtime_preview_v1'),
    storage: z.literal('temp_cache'),
  })
  .strict();

export type NegativeLabDryRunPreviewArtifact = z.infer<typeof negativeLabDryRunPreviewArtifactSchema>;
export type NegativeLabStagePreviewArtifact = NonNullable<NegativeLabDryRunPreviewArtifact['stageArtifacts']>[number];

export interface NegativeLabRuntimeDryRunAdapterResult {
  displayPreviewUrl: string;
  nativeArtifact: NegativeLabDryRunPreviewArtifact;
  runtimeDryRun: NegativeLabAppServerRuntimeDryRunToolResultV1;
}

const toRuntimePreviewRenderResult = (
  artifact: NegativeLabDryRunPreviewArtifact,
): NegativeLabRuntimePreviewRenderResultV1 => {
  const stageArtifacts = artifact.stageArtifacts?.map((stage) => ({
    colorDomain: stage.colorDomain,
    contentHash: stage.contentHash,
    dimensions: stage.dimensions,
    displayTransform: stage.displayTransform,
    previewDataUrl: stage.previewDataUrl,
    recipeHash: stage.recipeHash,
    stageId: stage.stageId,
    stageVersion: stage.stageVersion,
  }));
  return {
    artifactId: artifact.artifactId,
    baseFogSampleSummary: artifact.baseFogSampleSummary,
    contentHash: artifact.contentHash,
    densityNormalizationMetrics: {
      axisBounds: {
        color: artifact.densityNormalizationMetrics.axisBounds.color,
        luma: artifact.densityNormalizationMetrics.axisBounds.luma,
      },
      channelBounds: {
        blue: artifact.densityNormalizationMetrics.channelBounds.b,
        green: artifact.densityNormalizationMetrics.channelBounds.g,
        red: artifact.densityNormalizationMetrics.channelBounds.r,
      },
      boundsReceipt: {
        ...artifact.densityNormalizationMetrics.boundsReceipt,
        baseBounds: {
          axisBounds: artifact.densityNormalizationMetrics.boundsReceipt.baseBounds.axisBounds,
          channelBounds: {
            blue: artifact.densityNormalizationMetrics.boundsReceipt.baseBounds.channelBounds.b,
            green: artifact.densityNormalizationMetrics.boundsReceipt.baseBounds.channelBounds.g,
            red: artifact.densityNormalizationMetrics.boundsReceipt.baseBounds.channelBounds.r,
          },
        },
        finalBounds: {
          axisBounds: artifact.densityNormalizationMetrics.boundsReceipt.finalBounds.axisBounds,
          channelBounds: {
            blue: artifact.densityNormalizationMetrics.boundsReceipt.finalBounds.channelBounds.b,
            green: artifact.densityNormalizationMetrics.boundsReceipt.finalBounds.channelBounds.g,
            red: artifact.densityNormalizationMetrics.boundsReceipt.finalBounds.channelBounds.r,
          },
        },
      },
      clippedPixelCount: artifact.densityNormalizationMetrics.clippedPixelCount,
      densityRangeUnclamped: artifact.densityNormalizationMetrics.densityRangeUnclamped,
      epsilonClampedPixelCount: artifact.densityNormalizationMetrics.epsilonClampedPixelCount,
      rendererVersion: artifact.densityNormalizationMetrics.rendererVersion,
    },
    ...(artifact.densityScopes === undefined ? {} : { densityScopes: artifact.densityScopes }),
    dimensions: artifact.dimensions,
    renderer: artifact.renderer,
    ...(stageArtifacts === undefined ? {} : { stageArtifacts }),
    storage: artifact.storage,
  };
};

export async function renderNegativeLabRuntimeDryRunPreview(params: {
  command: Extract<NegativeLabCommandEnvelopeV1, { commandType: 'negativeLab.setConversionRecipe' }>;
  crosstalkProfile?: NegativeLabCrosstalkProfile | null;
  path: string;
  recipeParams: {
    analysis_buffer: number;
    base_fog_bounds_provenance: 'automatic_analysis' | 'manual_base_fog_sample' | 'profile_embedded_base_fog_sample';
    base_fog_sample: { height: number; width: number; x: number; y: number } | null;
    base_fog_strength: number;
    black_point: number;
    black_point_offset: number;
    blue_weight: number;
    bounds_schema_version: 1;
    color_range_clip: number;
    contrast: number;
    conversion_model?: 'density_rgb_v1' | 'negative_log_density_v1';
    exposure: number;
    green_weight: number;
    luma_range_clip: number;
    red_weight: number;
    white_point_offset: number;
    white_point: number;
  };
}): Promise<NegativeLabRuntimeDryRunAdapterResult> {
  const conversionModel =
    params.command.parameters.conversionModel.algorithmId === 'negative_log_density_v1'
      ? 'negative_log_density_v1'
      : 'density_rgb_v1';
  const nativeArtifact = await invokeWithSchema(
    Invokes.RenderNegativeLabDryRunPreviewArtifact,
    {
      params: {
        ...params.recipeParams,
        conversion_model: conversionModel,
      },
      ...(params.crosstalkProfile == null ? {} : { crosstalkProfile: params.crosstalkProfile }),
      path: params.path,
    },
    negativeLabDryRunPreviewArtifactSchema,
    Invokes.RenderNegativeLabDryRunPreviewArtifact,
  );

  const renderPreviewResult = toRuntimePreviewRenderResult(nativeArtifact);
  const toolBus = new NegativeLabAppServerRuntimeToolBusV1(NEGATIVE_LAB_AGENT_TOOL_MANIFEST, {
    renderPreview: () => renderPreviewResult,
  });
  const runtimeDryRun = toolBus.execute({
    request: params.command,
    toolName: NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME,
  });
  if (runtimeDryRun.kind !== 'dry_run') {
    throw new Error('Negative Lab runtime dry-run adapter expected a dry-run result.');
  }

  return {
    displayPreviewUrl: nativeArtifact.previewDataUrl,
    nativeArtifact,
    runtimeDryRun,
  };
}
