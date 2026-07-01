import { describe, expect, test } from 'bun:test';

import {
  type NegativeLabDustScratchReviewReport,
  negativeLabDustScratchReviewReportSchema,
} from '../../../src/schemas/negative-lab/negativeLabWorkspaceSchemas.ts';
import {
  applyDustCandidateDecisionTransition,
  buildDustCandidateHealLayer,
  buildDustHealCorrectionMetrics,
} from '../../../src/utils/dustCandidateHealLayer.ts';

type DustReviewFrame = NegativeLabDustScratchReviewReport['frames'][number];
type DustReviewCandidate = DustReviewFrame['candidates'][number];

const dustCandidate: DustReviewCandidate = {
  candidateId: 'negative_lab_dust_frame_001_1',
  confidence: 0.86,
  geometry: {
    coordinateSpace: 'normalized_frame',
    height: 0.04,
    kind: 'rect',
    width: 0.04,
    x: 0.48,
    y: 0.48,
  },
  kind: 'dust_spot',
  status: 'pending',
};

const scratchCandidate: DustReviewCandidate = {
  candidateId: 'negative_lab_scratch_frame_001_1',
  confidence: 0.64,
  geometry: {
    coordinateSpace: 'normalized_frame',
    height: 0.22,
    kind: 'rect',
    width: 0.03,
    x: 0.7,
    y: 0.2,
  },
  kind: 'emulsion_scratch',
  status: 'pending',
};

const reviewFrame: DustReviewFrame = {
  candidates: [dustCandidate, scratchCandidate],
  findingCodes: ['candidate_dust_spot', 'candidate_emulsion_scratch'],
  frameId: 'negative-lab-frame-001',
  included: true,
  recommendation: 'Review candidates before export.',
  scanLabel: 'Frame 001',
  severity: 'review',
};

const reviewReport = negativeLabDustScratchReviewReportSchema.parse({
  frames: [reviewFrame],
  reviewCount: 1,
  retouchCount: 0,
  schemaVersion: 1,
});

describe('negative lab dust candidate retouch layers', () => {
  test('transitions accepted dust candidates into editable heal layers', () => {
    const accepted = applyDustCandidateDecisionTransition({
      candidate: dustCandidate,
      decision: 'accepted',
      frameId: reviewFrame.frameId,
      imageHeight: 800,
      imageWidth: 1200,
      state: {
        decisionByCandidateId: {},
        healLayerByCandidateId: {},
      },
    });

    const healLayer = accepted.healLayerByCandidateId[dustCandidate.candidateId];
    expect(accepted.decisionByCandidateId[dustCandidate.candidateId]).toBe('accepted');
    expect(healLayer?.retouchCloneSource?.retouchMode).toBe('heal');
    expect(healLayer?.subMasks).toHaveLength(1);
    expect(healLayer?.retouchCloneSource?.candidateProvenance?.sourceFrameId).toBe(reviewFrame.frameId);

    const rejected = applyDustCandidateDecisionTransition({
      candidate: dustCandidate,
      decision: 'rejected',
      frameId: reviewFrame.frameId,
      imageHeight: 800,
      imageWidth: 1200,
      state: accepted,
    });

    expect(rejected.decisionByCandidateId[dustCandidate.candidateId]).toBe('rejected');
    expect(rejected.healLayerByCandidateId[dustCandidate.candidateId]).toBeUndefined();
  });

  test('keeps scratch candidates review-only when accept is requested', () => {
    const state = applyDustCandidateDecisionTransition({
      candidate: scratchCandidate,
      decision: 'accepted',
      frameId: reviewFrame.frameId,
      imageHeight: 800,
      imageWidth: 1200,
      state: {
        decisionByCandidateId: {},
        healLayerByCandidateId: {},
      },
    });

    expect(state.decisionByCandidateId[scratchCandidate.candidateId]).toBe('rejected');
    expect(Object.keys(state.healLayerByCandidateId)).toHaveLength(0);
  });

  test('builds accepted layer provenance with frame, candidate, hashes, and changed pixels', () => {
    const layer = buildDustCandidateHealLayer({
      candidate: dustCandidate,
      frameId: reviewFrame.frameId,
      imageHeight: 800,
      imageWidth: 1200,
      layerId: 'layer-negative-lab-dust-001',
      targetSubMaskId: 'mask-negative-lab-dust-001',
    });

    const cloneSource = layer.retouchCloneSource;
    const candidateProvenance = cloneSource?.candidateProvenance;
    const runtimeProvenance = cloneSource?.provenance;

    expect(layer.id).toBe('layer-negative-lab-dust-001');
    expect(layer.subMasks[0]?.id).toBe('mask-negative-lab-dust-001');
    expect(candidateProvenance).toMatchObject({
      algorithmId: 'local_heal_v1',
      candidateId: dustCandidate.candidateId,
      candidateKind: 'dust_spot',
      confidence: dustCandidate.confidence,
      origin: 'negative_lab_dust_candidate',
      sourceFrameId: reviewFrame.frameId,
      statusAtAcceptance: 'pending',
    });
    expect(candidateProvenance?.changedPixelCount).toBeGreaterThan(0);
    expect(candidateProvenance?.outputHash).toMatch(/^fnv1a32:[a-f0-9]{8}$/u);
    expect(candidateProvenance?.outputSampleHash).toMatch(/^fnv1a32:[a-f0-9]{8}$/u);
    expect(candidateProvenance?.sourceSampleHash).toMatch(/^fnv1a32:[a-f0-9]{8}$/u);
    expect(runtimeProvenance).toMatchObject({
      algorithmId: 'local_heal_v1',
      editableLayer: true,
      mode: 'heal',
      proofSource: 'negative_lab_candidate_acceptance_v1',
      provenanceVersion: 1,
      targetMaskId: 'mask-negative-lab-dust-001',
    });
    expect(runtimeProvenance?.changedPixelCount).toBe(candidateProvenance?.changedPixelCount);
    expect(runtimeProvenance?.outputHash).toBe(candidateProvenance?.outputHash);
    expect(runtimeProvenance?.sourceSampleHash).toBe(candidateProvenance?.sourceSampleHash);
  });

  test('summarizes accepted, pending, and rejected candidate states', () => {
    const accepted = applyDustCandidateDecisionTransition({
      candidate: dustCandidate,
      decision: 'accepted',
      frameId: reviewFrame.frameId,
      imageHeight: 800,
      imageWidth: 1200,
      state: {
        decisionByCandidateId: {},
        healLayerByCandidateId: {},
      },
    });
    const rejected = applyDustCandidateDecisionTransition({
      candidate: scratchCandidate,
      decision: 'rejected',
      frameId: reviewFrame.frameId,
      imageHeight: 800,
      imageWidth: 1200,
      state: accepted,
    });

    const metrics = buildDustHealCorrectionMetrics({
      decisionByCandidateId: rejected.decisionByCandidateId,
      healLayerByCandidateId: rejected.healLayerByCandidateId,
      reviewReport,
    });

    expect(metrics.acceptedCandidateCount).toBe(1);
    expect(metrics.rejectedCandidateCount).toBe(1);
    expect(metrics.pendingCandidateCount).toBe(0);
    expect(metrics.generatedHealLayerCount).toBe(1);
    expect(metrics.editableHealLayerCount).toBe(1);
    expect(metrics.runtimeProofStatus).toBe('needs_real_raw_output_proof');
  });
});
