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
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
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
  contentHash: artifact.contentHash,
  dimensions: artifact.dimensions,
  renderer: artifact.renderer,
  storage: artifact.storage,
});

export async function renderNegativeLabRuntimeDryRunPreview(params: {
  command: NegativeLabCommandEnvelopeV1;
  path: string;
  recipeParams: {
    base_fog_sample: { height: number; width: number; x: number; y: number } | null;
    base_fog_strength: number;
    black_point: number;
    blue_weight: number;
    contrast: number;
    exposure: number;
    green_weight: number;
    red_weight: number;
    white_point: number;
  };
}): Promise<NegativeLabRuntimeDryRunAdapterResult> {
  const nativeArtifact = await invokeWithSchema(
    Invokes.RenderNegativeLabDryRunPreviewArtifact,
    {
      params: params.recipeParams,
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
