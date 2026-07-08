import { describe, expect, test } from 'bun:test';
import {
  ActorKind,
  ApprovalClass,
  negativeLabApplyResultV1Schema,
  negativeLabCommandEnvelopeV1Schema,
  negativeLabDryRunResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/index.ts';
import {
  NegativeLabAppServerRuntimeToolBusV1,
  negativeLabAcceptedDryRunPlanHashV1,
} from '../../../packages/rawengine-schema/src/negativeLabAppServerRuntime.ts';
import { NEGATIVE_LAB_AGENT_TOOL_MANIFEST } from '../../../src/utils/negative-lab/app-server/negativeLabAgentAppServerToolDispatch.ts';

describe('Negative Lab before/after preview proof', () => {
  test('proves source-negative metadata beside generated-positive dry-run output and gates apply by accepted plan identity', () => {
    const bus = new NegativeLabAppServerRuntimeToolBusV1(NEGATIVE_LAB_AGENT_TOOL_MANIFEST, {
      renderPreview: () => ({
        artifactId: 'artifact_negative_lab_generated_positive_preview',
        baseFogSampleSummary: {
          clippedFraction: 0,
          confidence: 0.88,
          densityRange: 0.09,
          densityRgb: { b: 0.62, g: 0.56, r: 0.53 },
          meanRgb: { b: 0.2399, g: 0.2754, r: 0.2951 },
          sampleCount: 512,
          sampleRect: { height: 0.5, width: 0.1, x: 0.04, y: 0.24 },
          source: 'requested_base_fog_sample_rect',
          warningCodes: ['uneven_illumination'],
        },
        contentHash: 'sha256:positive_preview_pixels_001',
        dimensions: { height: 720, width: 1080 },
        renderer: 'rawengine_negative_lab_runtime_preview_v1',
        storage: 'temp_cache',
      }),
    });
    const command = negativeLabCommandEnvelopeV1Schema.parse({
      actor: {
        id: 'negative-lab-preview-proof-test',
        kind: ActorKind.Test,
        sessionId: 'session_negative_lab_preview_proof',
      },
      approval: {
        approvalClass: ApprovalClass.PreviewOnly,
        reason: 'Build deterministic before/after proof before mutating apply.',
        state: 'not_required',
      },
      commandId: 'command_negative_lab_preview_proof',
      commandType: 'negativeLab.setConversionRecipe',
      correlationId: 'corr_negative_lab_preview_proof',
      dryRun: true,
      expectedGraphRevision: 'graph_rev_negative_lab_preview_proof',
      idempotencyKey: 'idem_negative_lab_preview_proof',
      parameters: {
        baseStrategy: {
          baseSampleIds: ['base_sample_frame_001'],
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
          curveFamily: 'process_profile_monotonic_v1',
          processProfileId: 'rawengine_measured_process_profile_c41_v1',
        },
        frameSelection: {
          excludeFrameIds: [],
          frameIds: ['frame_001'],
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
          sampleIds: ['base_sample_frame_001'],
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
        sessionId: 'session_negative_lab_preview_proof',
      },
      schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
      target: {
        imagePath: '/roll-01/frame-001-negative.dng',
        kind: 'image',
      },
    });

    const dryRunResult = bus.execute({
      request: command,
      toolName: 'negativelab.preview_conversion',
    });

    expect(dryRunResult.kind).toBe('dry_run');
    const dryRun = negativeLabDryRunResultV1Schema.parse(dryRunResult.dryRun);
    const beforeAfterProof = dryRun.proof?.runtimePreview.beforeAfterPreviewProof;
    expect(beforeAfterProof).toBeDefined();
    expect(beforeAfterProof?.sourceNegativeArtifact).toMatchObject({
      dimensions: { height: 720, width: 1080 },
      imagePath: '/roll-01/frame-001-negative.dng',
      kind: 'source_negative',
      storage: 'source_file',
    });
    expect(beforeAfterProof?.sourceNegativeArtifact.artifactId).not.toBe(
      beforeAfterProof?.generatedPositiveDryRunArtifact.artifactId,
    );
    expect(beforeAfterProof?.sourceNegativeArtifact.contentHash).toMatch(/^sha256:source_negative:/u);
    expect(beforeAfterProof?.generatedPositiveDryRunArtifact).toEqual({
      artifactId: 'artifact_negative_lab_generated_positive_preview',
      contentHash: 'sha256:positive_preview_pixels_001',
      dimensions: { height: 720, width: 1080 },
      kind: 'preview',
      storage: 'temp_cache',
    });
    expect(beforeAfterProof?.baseFogSampleSummary).toMatchObject({
      confidence: 0.88,
      sampleCount: 512,
      source: 'requested_base_fog_sample_rect',
      warningCodes: ['uneven_illumination'],
    });
    expect(beforeAfterProof?.warningCodes).toEqual(['low_acquisition_confidence', 'uneven_illumination']);
    expect(beforeAfterProof?.claimLevel).toBe('measured_project_profile');
    expect(beforeAfterProof?.acceptedDryRunPlanRequirement).toEqual({
      acceptedDryRunPlanHash: dryRunResult.acceptedDryRunPlanHash,
      dryRunPlanId: dryRun.dryRunPlanId,
      requiredBeforeApply: true,
    });
    expect(beforeAfterProof?.behaviorProofHash).toMatch(/^sha256:/u);
    expect(dryRunResult.acceptedDryRunPlanHash).toBe(negativeLabAcceptedDryRunPlanHashV1(dryRun));
    expect(dryRun.proof?.runtimePreview.densityNormalizationMetrics.rendererVersion).toBe(1);
    expect(dryRun.proof?.runtimePreview.densityNormalizationMetrics.densityRangeUnclamped).toBeGreaterThan(0);

    expect(() =>
      bus.execute({
        request: {
          acknowledgedWarningCodes: beforeAfterProof?.warningCodes ?? [],
          acceptedDryRunPlanHash: 'sha256:wrong_preview_proof',
          approval: {
            approvalClass: ApprovalClass.EditApply,
            reason: 'Deliberately wrong dry-run hash should not apply.',
            state: 'approved',
          },
          commandId: command.commandId,
          dryRunPlanId: dryRun.dryRunPlanId,
          expectedSessionRevision: 'graph_rev_negative_lab_preview_proof',
          sessionId: 'session_negative_lab_preview_proof',
        },
        toolName: 'negativelab.apply_planned_command',
      }),
    ).toThrow('rejected an unaccepted Negative Lab dry-run plan');

    const applyResult = bus.execute({
      request: {
        acknowledgedWarningCodes: beforeAfterProof?.warningCodes ?? [],
        acceptedDryRunPlanHash: dryRunResult.acceptedDryRunPlanHash,
        approval: {
          approvalClass: ApprovalClass.EditApply,
          reason: 'Apply accepted deterministic before/after dry-run proof.',
          state: 'approved',
        },
        commandId: command.commandId,
        dryRunPlanId: dryRun.dryRunPlanId,
        expectedSessionRevision: 'graph_rev_negative_lab_preview_proof',
        sessionId: 'session_negative_lab_preview_proof',
      },
      toolName: 'negativelab.apply_planned_command',
    });

    expect(applyResult.kind).toBe('apply');
    const apply = negativeLabApplyResultV1Schema.parse(applyResult.apply);
    expect(apply.positiveOutputReceipts[0]).toMatchObject({
      acceptedDryRunPlanHash: dryRunResult.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: dryRun.dryRunPlanId,
      dimensions: { height: 720, width: 1080 },
      sourcePath: '/roll-01/frame-001-negative.dng',
    });
    expect(apply.proof?.runtimePreview.beforeAfterPreviewProof.acceptedDryRunPlanRequirement).toEqual(
      beforeAfterProof?.acceptedDryRunPlanRequirement,
    );
  });

  test('accepts negative_log_density_v1 as a first-class conversion model', () => {
    const bus = new NegativeLabAppServerRuntimeToolBusV1(NEGATIVE_LAB_AGENT_TOOL_MANIFEST);
    const command = negativeLabCommandEnvelopeV1Schema.parse({
      actor: {
        id: 'negative-lab-preview-proof-neg-log',
        kind: ActorKind.Test,
        sessionId: 'session_negative_lab_preview_proof_neg_log',
      },
      approval: {
        approvalClass: ApprovalClass.PreviewOnly,
        reason: 'Exercise the negative log density runtime proof contract.',
        state: 'not_required',
      },
      commandId: 'command_negative_lab_preview_proof_neg_log',
      commandType: 'negativeLab.setConversionRecipe',
      correlationId: 'corr_negative_lab_preview_proof_neg_log',
      dryRun: true,
      expectedGraphRevision: 'graph_rev_negative_lab_preview_proof_neg_log',
      idempotencyKey: 'idem_negative_lab_preview_proof_neg_log',
      parameters: {
        baseStrategy: {
          baseSampleIds: ['base_sample_frame_002'],
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
          frameIds: ['frame_002'],
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
          sampleIds: ['base_sample_frame_002'],
        },
        outputIntent: 'proof_preview',
        previewRequest: {
          artifactPurposes: ['objective_positive_preview'],
          includePreview: true,
          maxEdgePx: 1080,
        },
        processFamily: 'c41_color_negative',
        sessionId: 'session_negative_lab_preview_proof_neg_log',
      },
      schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
      target: {
        imagePath: '/roll-01/frame-002-negative.dng',
        kind: 'image',
      },
    });

    const dryRunResult = bus.execute({
      request: command,
      toolName: 'negativelab.preview_conversion',
    });
    if (dryRunResult.kind !== 'dry_run') throw new Error('Expected negative log density dry-run result.');

    expect(dryRunResult.dryRun.proof?.algorithm.algorithmId).toBe('negative_log_density_v1');
    expect(dryRunResult.dryRun.proof?.runtimePreview.densityNormalizationMetrics.rendererVersion).toBe(1);
  });
});
