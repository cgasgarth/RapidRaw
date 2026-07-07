import { describe, expect, mock, test } from 'bun:test';

import {
  ActorKind,
  ApprovalClass,
  negativeLabCommandEnvelopeV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/index.ts';
import { Invokes } from '../../../src/tauri/commands';
import {
  NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME,
  NEGATIVE_LAB_AGENT_TOOL_MANIFEST,
} from '../../../src/utils/negative-lab/app-server/negativeLabAgentAppServerToolDispatch';
import { renderNegativeLabRuntimeDryRunPreview } from '../../../src/utils/negative-lab/negativeLabRuntimeDryRunAdapter';

const invokeMock = mock((command: string) => {
  if (command !== Invokes.RenderNegativeLabDryRunPreviewArtifact) {
    throw new Error(`Unexpected invoke: ${command}`);
  }

  return Promise.resolve({
    artifactId: 'artifact_negative_lab_runtime_preview_adapter',
    baseFogSampleSummary: {
      clippedFraction: 0,
      confidence: 0.81,
      densityRange: 0.07,
      densityRgb: {
        b: 0.55,
        g: 0.51,
        r: 0.48,
      },
      meanRgb: {
        b: 0.2818,
        g: 0.309,
        r: 0.3311,
      },
      sampleCount: 400,
      sampleRect: {
        height: 0.6,
        width: 0.12,
        x: 0.02,
        y: 0.2,
      },
      source: 'deterministic_edge_safe_default_rect',
      warningCodes: [],
    },
    contentHash: 'sha256:4b05ce465b138a4232a9cf196884b41c6dd3b9a1a3f2f2916e4e3e78328701dd',
    densityNormalizationMetrics: {
      channelBounds: {
        b: { max: 1.06, min: -0.03 },
        g: { max: 1.01, min: -0.02 },
        r: { max: 0.97, min: -0.01 },
      },
      clippedPixelCount: 3,
      densityRangeUnclamped: 1.09,
      epsilonClampedPixelCount: 1,
      rendererVersion: 1,
    },
    dimensions: {
      height: 480,
      width: 720,
    },
    previewDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==',
    renderer: 'rawengine_negative_lab_runtime_preview_v1',
    storage: 'temp_cache',
  });
});

mock.module('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

describe('renderNegativeLabRuntimeDryRunPreview', () => {
  test('uses native rendered preview metadata for the typed dry-run artifact', async () => {
    const command = negativeLabCommandEnvelopeV1Schema.parse({
      actor: {
        id: 'negative-lab-ui',
        kind: ActorKind.Ui,
        sessionId: 'session_negative_lab_adapter',
      },
      approval: {
        approvalClass: ApprovalClass.PreviewOnly,
        reason: 'Runtime preview render adapter test',
        state: 'not_required',
      },
      commandId: 'command_negative_lab_adapter_preview',
      commandType: 'negativeLab.setConversionRecipe',
      correlationId: 'corr_negative_lab_adapter_preview',
      dryRun: true,
      expectedGraphRevision: 'graph_rev_negative_lab_adapter_preview',
      idempotencyKey: 'idem_negative_lab_adapter_preview',
      parameters: {
        baseStrategy: {
          baseSampleIds: ['base_sample_adapter_preview'],
          mode: 'manual_samples',
        },
        conversionModel: {
          algorithmId: 'density_rgb_v1',
          algorithmVersion: 1,
          densityMax: 4,
          epsilonPolicyId: 'density_epsilon_v1',
          negativeDensityTolerance: 0.02,
        },
        curveModel: {
          curveFamily: 'parametric_monotonic_v1',
        },
        frameSelection: {
          excludeFrameIds: [],
          frameIds: ['frame_0001'],
          mode: 'selected',
          qcStatuses: [],
          warningCodes: [],
        },
        inputCharacterization: {
          channelBasis: 'scanner_rgb',
          confidence: 'profiled_acquisition',
          pixelBasis: 'linear_scan_rgb',
        },
        neutralization: {
          mode: 'neutral_sample',
          sampleIds: ['base_sample_adapter_preview'],
        },
        outputIntent: 'proof_preview',
        outputTransformRef: {
          chromaticAdaptation: 'bradford',
          renderingIntent: 'scene_referred',
          transformId: 'rawengine_scene_linear_v1',
        },
        previewRequest: {
          artifactPurposes: ['objective_positive_preview', 'warning_report'],
          includePreview: true,
          maxEdgePx: 1080,
        },
        processFamily: 'c41_color_negative',
        sessionId: 'session_negative_lab_adapter',
      },
      schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
      target: {
        imagePath: '/synthetic/negative-lab-adapter-source.dng',
        kind: 'image',
      },
    });

    const result = await renderNegativeLabRuntimeDryRunPreview({
      command,
      path: '/synthetic/negative-lab-adapter-source.dng',
      recipeParams: {
        base_fog_sample: null,
        base_fog_strength: 1,
        black_point: 0,
        blue_weight: 1,
        contrast: 1,
        conversion_model: 'density_rgb_v1',
        exposure: 0,
        green_weight: 1,
        red_weight: 1,
        white_point: 1,
      },
    });

    expect(invokeMock).toHaveBeenCalledWith(Invokes.RenderNegativeLabDryRunPreviewArtifact, {
      params: {
        base_fog_sample: null,
        base_fog_strength: 1,
        black_point: 0,
        blue_weight: 1,
        contrast: 1,
        conversion_model: 'density_rgb_v1',
        exposure: 0,
        green_weight: 1,
        red_weight: 1,
        white_point: 1,
      },
      path: '/synthetic/negative-lab-adapter-source.dng',
    });
    expect(result.displayPreviewUrl).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==');
    expect(result.nativeArtifact.renderer).toBe('rawengine_negative_lab_runtime_preview_v1');
    expect(result.runtimeDryRun.toolName).toBe(NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME);
    expect(result.runtimeDryRun.dryRun.previewArtifacts[0]).toMatchObject({
      artifactId: 'artifact_negative_lab_runtime_preview_adapter',
      contentHash: 'sha256:4b05ce465b138a4232a9cf196884b41c6dd3b9a1a3f2f2916e4e3e78328701dd',
      dimensions: {
        height: 480,
        width: 720,
      },
      storage: 'temp_cache',
    });
    expect(result.runtimeDryRun.dryRun.proof?.runtimePreview.previewRenderer).toBe(
      'rawengine_negative_lab_runtime_preview_v1',
    );
    expect(result.runtimeDryRun.dryRun.proof?.runtimePreview.baseFogSampleSummary).toMatchObject({
      confidence: 0.81,
      sampleCount: 400,
      source: 'deterministic_edge_safe_default_rect',
    });
    expect(result.runtimeDryRun.dryRun.proof?.runtimePreview.densityNormalizationMetrics).toEqual({
      channelBounds: {
        blue: { max: 1.06, min: -0.03 },
        green: { max: 1.01, min: -0.02 },
        red: { max: 0.97, min: -0.01 },
      },
      clippedPixelCount: 3,
      densityRangeUnclamped: 1.09,
      epsilonClampedPixelCount: 1,
      rendererVersion: 1,
    });
    expect(result.runtimeDryRun.dryRun.changeSet.createdPositiveVariantIds).toEqual([]);
    expect(NEGATIVE_LAB_AGENT_TOOL_MANIFEST.tools[0]?.toolName).toBe(NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME);
  });

  test('passes through the new negative log density conversion model', async () => {
    const command = negativeLabCommandEnvelopeV1Schema.parse({
      actor: {
        id: 'negative-lab-ui',
        kind: ActorKind.Ui,
        sessionId: 'session_negative_lab_adapter_neg_log',
      },
      approval: {
        approvalClass: ApprovalClass.PreviewOnly,
        reason: 'Negative log density adapter test',
        state: 'not_required',
      },
      commandId: 'command_negative_lab_adapter_neg_log',
      commandType: 'negativeLab.setConversionRecipe',
      correlationId: 'corr_negative_lab_adapter_neg_log',
      dryRun: true,
      expectedGraphRevision: 'graph_rev_negative_lab_adapter_neg_log',
      idempotencyKey: 'idem_negative_lab_adapter_neg_log',
      parameters: {
        baseStrategy: {
          baseSampleIds: ['base_sample_adapter_neg_log'],
          mode: 'manual_samples',
        },
        conversionModel: {
          algorithmId: 'negative_log_density_v1',
          algorithmVersion: 1,
          densityMax: 4,
          epsilonPolicyId: 'density_epsilon_v1',
          negativeDensityTolerance: 0.02,
        },
        curveModel: {
          curveFamily: 'parametric_monotonic_v1',
        },
        frameSelection: {
          excludeFrameIds: [],
          frameIds: ['frame_0001'],
          mode: 'selected',
          qcStatuses: [],
          warningCodes: [],
        },
        inputCharacterization: {
          channelBasis: 'scanner_rgb',
          confidence: 'profiled_acquisition',
          pixelBasis: 'linear_scan_rgb',
        },
        neutralization: {
          mode: 'neutral_sample',
          sampleIds: ['base_sample_adapter_neg_log'],
        },
        outputIntent: 'proof_preview',
        outputTransformRef: {
          chromaticAdaptation: 'bradford',
          renderingIntent: 'scene_referred',
          transformId: 'rawengine_scene_linear_v1',
        },
        previewRequest: {
          artifactPurposes: ['objective_positive_preview'],
          includePreview: true,
          maxEdgePx: 1080,
        },
        processFamily: 'c41_color_negative',
        sessionId: 'session_negative_lab_adapter_neg_log',
      },
      schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
      target: {
        imagePath: '/synthetic/negative-lab-adapter-neg-log.dng',
        kind: 'image',
      },
    });

    await renderNegativeLabRuntimeDryRunPreview({
      command,
      path: '/synthetic/negative-lab-adapter-neg-log.dng',
      recipeParams: {
        base_fog_sample: null,
        base_fog_strength: 1,
        black_point: 0,
        blue_weight: 1,
        contrast: 1,
        exposure: 0,
        green_weight: 1,
        red_weight: 1,
        white_point: 1,
      },
    });

    expect(invokeMock).toHaveBeenLastCalledWith(Invokes.RenderNegativeLabDryRunPreviewArtifact, {
      params: {
        base_fog_sample: null,
        base_fog_strength: 1,
        black_point: 0,
        blue_weight: 1,
        contrast: 1,
        conversion_model: 'negative_log_density_v1',
        exposure: 0,
        green_weight: 1,
        red_weight: 1,
        white_point: 1,
      },
      path: '/synthetic/negative-lab-adapter-neg-log.dng',
    });
  });
});
