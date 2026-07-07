import { z } from 'zod';

import {
  type NegativeLabAppServerRuntimeDryRunToolResultV1,
  NegativeLabAppServerRuntimeToolBusV1,
  type NegativeLabCommandEnvelopeV1,
  type NegativeLabRuntimePreviewRenderResultV1,
} from '../../../packages/rawengine-schema/src';
import { Invokes } from '../../tauri/commands';
import { invokeWithSchema } from '../tauriSchemaInvoke';
import {
  NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME,
  NEGATIVE_LAB_AGENT_TOOL_MANIFEST,
} from './app-server/negativeLabAgentAppServerToolDispatch';

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
        channelBounds: z
          .object({
            b: z.object({ max: z.number(), min: z.number() }).strict(),
            g: z.object({ max: z.number(), min: z.number() }).strict(),
            r: z.object({ max: z.number(), min: z.number() }).strict(),
          })
          .strict(),
        clippedPixelCount: z.number().int().nonnegative(),
        densityRangeUnclamped: z.number().nonnegative(),
        epsilonClampedPixelCount: z.number().int().nonnegative(),
        rendererVersion: z.number().int().positive(),
      })
      .strict(),
    dimensions: z
      .object({
        height: z.number().int().positive(),
        width: z.number().int().positive(),
      })
      .strict(),
    previewDataUrl: z.string().startsWith('data:image/jpeg;base64,'),
    renderer: z.literal('rawengine_negative_lab_runtime_preview_v1'),
    storage: z.literal('temp_cache'),
  })
  .strict();

export type NegativeLabDryRunPreviewArtifact = z.infer<typeof negativeLabDryRunPreviewArtifactSchema>;

export interface NegativeLabRuntimeDryRunAdapterResult {
  displayPreviewUrl: string;
  nativeArtifact: NegativeLabDryRunPreviewArtifact;
  runtimeDryRun: NegativeLabAppServerRuntimeDryRunToolResultV1;
}

const toRuntimePreviewRenderResult = (
  artifact: NegativeLabDryRunPreviewArtifact,
): NegativeLabRuntimePreviewRenderResultV1 => ({
  artifactId: artifact.artifactId,
  baseFogSampleSummary: artifact.baseFogSampleSummary,
  contentHash: artifact.contentHash,
  densityNormalizationMetrics: {
    channelBounds: {
      blue: artifact.densityNormalizationMetrics.channelBounds.b,
      green: artifact.densityNormalizationMetrics.channelBounds.g,
      red: artifact.densityNormalizationMetrics.channelBounds.r,
    },
    clippedPixelCount: artifact.densityNormalizationMetrics.clippedPixelCount,
    densityRangeUnclamped: artifact.densityNormalizationMetrics.densityRangeUnclamped,
    epsilonClampedPixelCount: artifact.densityNormalizationMetrics.epsilonClampedPixelCount,
    rendererVersion: artifact.densityNormalizationMetrics.rendererVersion,
  },
  dimensions: artifact.dimensions,
  renderer: artifact.renderer,
  storage: artifact.storage,
});

export async function renderNegativeLabRuntimeDryRunPreview(params: {
  command: Extract<NegativeLabCommandEnvelopeV1, { commandType: 'negativeLab.setConversionRecipe' }>;
  path: string;
  recipeParams: {
    base_fog_sample: { height: number; width: number; x: number; y: number } | null;
    base_fog_strength: number;
    black_point: number;
    blue_weight: number;
    contrast: number;
    conversion_model?: 'density_rgb_v1' | 'negative_log_density_v1';
    exposure: number;
    green_weight: number;
    red_weight: number;
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
