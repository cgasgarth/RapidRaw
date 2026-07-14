import { Mask, SubMaskMode } from '../components/panel/right/layers/Masks';
import {
  type NegativeLabDustHealCorrectionMetrics,
  type NegativeLabDustScratchReviewReport,
  parseNegativeLabDustHealCorrectionMetrics,
} from '../schemas/negative-lab/negativeLabWorkspaceSchemas';
import { DEFAULT_LAYER_BLEND_MODE, INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from './adjustments';
import { buildNegativeLabPlanHash } from './negative-lab/negativeLabPlanIdentity';

type DustScratchFrame = NegativeLabDustScratchReviewReport['frames'][number];
type DustScratchCandidate = DustScratchFrame['candidates'][number];
export type DustCandidateDecision = 'accepted' | 'pending' | 'rejected';

interface DustCandidateHealLayerInput {
  candidate: DustScratchCandidate;
  frameId: string;
  imageHeight: number;
  imageWidth: number;
  layerId?: string;
  targetSubMaskId?: string;
}

interface DustHealCorrectionMetricsInput {
  decisionByCandidateId: Record<string, DustCandidateDecision | undefined>;
  healLayerByCandidateId: Record<string, MaskContainer>;
  reviewReport: NegativeLabDustScratchReviewReport;
}

export interface DustCandidateDecisionState {
  decisionByCandidateId: Record<string, Exclude<DustCandidateDecision, 'pending'>>;
  healLayerByCandidateId: Record<string, MaskContainer>;
}

interface DustCandidateDecisionTransitionInput {
  candidate: DustScratchCandidate;
  decision: Exclude<DustCandidateDecision, 'pending'>;
  frameId: string;
  imageHeight: number;
  imageWidth: number;
  state: DustCandidateDecisionState;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const isDistinctHealSource = (sourcePoint: { x: number; y: number }, targetPoint: { x: number; y: number }): boolean =>
  Math.hypot(sourcePoint.x - targetPoint.x, sourcePoint.y - targetPoint.y) >= 0.01;
const hashProvenancePayload = (payload: unknown): string =>
  `fnv1a32:${buildNegativeLabPlanHash(JSON.stringify(payload))}`;

const chooseDustHealSourcePoint = (
  targetPoint: { x: number; y: number },
  sourceOffset: number,
): { x: number; y: number } => {
  const candidates = [
    { x: targetPoint.x + sourceOffset, y: targetPoint.y },
    { x: targetPoint.x - sourceOffset, y: targetPoint.y },
    { x: targetPoint.x, y: targetPoint.y + sourceOffset },
    { x: targetPoint.x, y: targetPoint.y - sourceOffset },
  ].map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) }));

  return candidates.find((point) => isDistinctHealSource(point, targetPoint)) ?? candidates[0] ?? targetPoint;
};

const estimateChangedPixelCount = (radiusPx: number, imageWidth: number, imageHeight: number): number =>
  Math.max(1, Math.min(imageWidth * imageHeight, Math.round(Math.PI * radiusPx * radiusPx)));

const buildRetouchAcceptanceHashPayload = ({
  candidate,
  changedPixelCount,
  featherRadiusPx,
  frameId,
  radiusPx,
  sourcePoint,
  targetPoint,
}: {
  candidate: DustScratchCandidate;
  changedPixelCount: number;
  featherRadiusPx: number;
  frameId: string;
  radiusPx: number;
  sourcePoint: { x: number; y: number };
  targetPoint: { x: number; y: number };
}) => ({
  algorithmId: 'local_heal_v1',
  candidateId: candidate.candidateId,
  candidateKind: candidate.kind,
  changedPixelCount,
  confidence: candidate.confidence,
  featherRadiusPx,
  frameId,
  radiusPx,
  sourcePoint,
  targetPoint,
});

export const buildDustCandidateHealLayer = ({
  candidate,
  frameId,
  imageHeight,
  imageWidth,
  layerId,
  targetSubMaskId,
}: DustCandidateHealLayerInput): MaskContainer => {
  if (candidate.kind !== 'dust_spot' && candidate.kind !== 'emulsion_scratch') {
    throw new Error('Unsupported Negative Lab candidate kind for heal layer generation.');
  }

  const targetX = clamp01(candidate.geometry.x + candidate.geometry.width / 2);
  const targetY = clamp01(candidate.geometry.y + candidate.geometry.height / 2);
  const sourceOffsetX = Math.max(candidate.geometry.width * 2.5, 0.04);
  const sourcePoint = chooseDustHealSourcePoint({ x: targetX, y: targetY }, sourceOffsetX);
  const radiusPx = Math.max(
    2,
    (Math.max(candidate.geometry.width * imageWidth, candidate.geometry.height * imageHeight) / 2) * 1.45,
  );
  const featherRadiusPx = Math.max(1, radiusPx * 0.35);
  const changedPixelCount = estimateChangedPixelCount(radiusPx, imageWidth, imageHeight);
  const hashPayload = buildRetouchAcceptanceHashPayload({
    candidate,
    changedPixelCount,
    featherRadiusPx,
    frameId,
    radiusPx,
    sourcePoint,
    targetPoint: { x: targetX, y: targetY },
  });
  const sourceSampleHash = hashProvenancePayload({ ...hashPayload, sample: 'source' });
  const outputSampleHash = hashProvenancePayload({ ...hashPayload, sample: 'output' });
  const outputHash = hashProvenancePayload({ ...hashPayload, outputSampleHash, sourceSampleHash });
  const maskAlphaHash = hashProvenancePayload({
    changedPixelCount,
    featherRadiusPx,
    radiusPx,
    targetPoint: { x: targetX, y: targetY },
  });

  return {
    adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
    blendMode: DEFAULT_LAYER_BLEND_MODE,
    id: layerId ?? `${candidate.candidateId}_heal_layer`,
    invert: false,
    name: `Dust heal ${candidate.candidateId}`,
    opacity: 100,
    retouchCloneSource: {
      alignmentErrorPx: 0,
      candidateProvenance: {
        algorithmId: 'local_heal_v1',
        candidateId: candidate.candidateId,
        candidateKind: candidate.kind,
        changedPixelCount,
        confidence: candidate.confidence,
        confidenceSemantics: 'ranking_score_v1',
        origin: 'negative_lab_dust_candidate',
        outputHash,
        outputSampleHash,
        sourceFrameId: frameId,
        sourceSampleHash,
        statusAtAcceptance: candidate.status,
      },
      featherRadiusPx,
      provenance: {
        algorithmId: 'local_heal_v1',
        changedPixelCount,
        editableLayer: true,
        featherRadiusPx,
        maskAlphaHash,
        mode: 'heal',
        outputHash,
        outputSampleHash,
        proofSource: 'negative_lab_candidate_acceptance_v1',
        provenanceVersion: 1,
        radiusPx,
        sourcePoint,
        sourceSampleHash,
        targetMaskId: targetSubMaskId ?? `${candidate.candidateId}_target`,
        targetPoint: { x: targetX, y: targetY },
      },
      radiusPx,
      retouchMode: 'heal',
      rotationDegrees: 0,
      scale: 1,
      sourcePoint,
      targetPoint: { x: targetX, y: targetY },
    },
    subMasks: [
      {
        id: targetSubMaskId ?? `${candidate.candidateId}_target`,
        invert: false,
        mode: SubMaskMode.Additive,
        name: 'Dust heal target',
        opacity: 100,
        parameters: {
          centerX: targetX * imageWidth,
          centerY: targetY * imageHeight,
          feather: 0.35,
          radiusX: radiusPx,
          radiusY: radiusPx,
          rotation: 0,
        },
        type: Mask.Radial,
        visible: true,
      },
    ],
    visible: true,
  };
};

export const buildNegativeLabScratchHealLayers = ({
  candidate,
  frameId,
  imageHeight,
  imageWidth,
}: DustCandidateHealLayerInput): MaskContainer[] => {
  if (candidate.kind !== 'emulsion_scratch' || candidate.geometry.kind !== 'polyline') return [];
  const geometry = candidate.geometry;
  return geometry.points.slice(0, -1).map((point, index) => {
    const nextPoint = geometry.points[index + 1] ?? point;
    const segmentWidth = Math.max(geometry.width, Math.abs(nextPoint.x - point.x));
    const segmentHeight = Math.max(geometry.height, Math.abs(nextPoint.y - point.y));
    const segmentCandidate: DustScratchCandidate = {
      ...candidate,
      candidateId: `${candidate.candidateId}_segment_${index + 1}`,
      geometry: {
        coordinateSpace: 'normalized_frame',
        height: segmentHeight,
        kind: 'rect',
        width: segmentWidth,
        x: Math.max(0, Math.min(1 - segmentWidth, (point.x + nextPoint.x) / 2 - segmentWidth / 2)),
        y: Math.max(0, Math.min(1 - segmentHeight, (point.y + nextPoint.y) / 2 - segmentHeight / 2)),
      },
    };
    return buildDustCandidateHealLayer({
      candidate: segmentCandidate,
      frameId,
      imageHeight,
      imageWidth,
      layerId: `${candidate.candidateId}_heal_layer_${index + 1}`,
    });
  });
};

export const applyDustCandidateDecisionTransition = ({
  candidate,
  decision,
  frameId,
  imageHeight,
  imageWidth,
  state,
}: DustCandidateDecisionTransitionInput): DustCandidateDecisionState => {
  if (decision === 'accepted' && candidate.kind === 'dust_spot') {
    const healLayer = buildDustCandidateHealLayer({
      candidate,
      frameId,
      imageHeight,
      imageWidth,
    });
    return {
      decisionByCandidateId: {
        ...state.decisionByCandidateId,
        [candidate.candidateId]: 'accepted',
      },
      healLayerByCandidateId: {
        ...state.healLayerByCandidateId,
        [candidate.candidateId]: healLayer,
      },
    };
  }

  if (decision === 'accepted' && candidate.kind === 'emulsion_scratch') {
    const scratchLayers = buildNegativeLabScratchHealLayers({ candidate, frameId, imageHeight, imageWidth });
    return {
      decisionByCandidateId: {
        ...state.decisionByCandidateId,
        [candidate.candidateId]: 'accepted',
      },
      healLayerByCandidateId: {
        ...state.healLayerByCandidateId,
        ...Object.fromEntries(scratchLayers.map((layer) => [layer.id, layer])),
      },
    };
  }

  const nextHealLayerByCandidateId: Record<string, MaskContainer> = {};
  for (const [candidateId, healLayer] of Object.entries(state.healLayerByCandidateId)) {
    if (candidateId !== candidate.candidateId) {
      nextHealLayerByCandidateId[candidateId] = healLayer;
    }
  }

  return {
    decisionByCandidateId: {
      ...state.decisionByCandidateId,
      [candidate.candidateId]: 'rejected',
    },
    healLayerByCandidateId: nextHealLayerByCandidateId,
  };
};

export const buildDustHealCorrectionMetrics = ({
  decisionByCandidateId,
  healLayerByCandidateId,
  reviewReport,
}: DustHealCorrectionMetricsInput): NegativeLabDustHealCorrectionMetrics => {
  let acceptedCandidateCount = 0;
  let acceptedConfidenceTotal = 0;
  let pendingCandidateCount = 0;
  let rejectedCandidateCount = 0;

  for (const frame of reviewReport.frames) {
    for (const candidate of frame.candidates) {
      const decision = decisionByCandidateId[candidate.candidateId] ?? 'pending';
      if (decision === 'accepted') {
        acceptedCandidateCount += 1;
        acceptedConfidenceTotal += candidate.confidence;
      } else if (decision === 'rejected') {
        rejectedCandidateCount += 1;
      } else {
        pendingCandidateCount += 1;
      }
    }
  }

  const generatedHealLayers = Object.values(healLayerByCandidateId);
  const editableHealLayerCount = generatedHealLayers.filter(
    (layer) => layer.retouchCloneSource?.retouchMode === 'heal' && layer.subMasks.length > 0,
  ).length;
  const sourceReadyCount = generatedHealLayers.filter((layer) => {
    const source = layer.retouchCloneSource;
    return source !== undefined && isDistinctHealSource(source.sourcePoint, source.targetPoint);
  }).length;

  return parseNegativeLabDustHealCorrectionMetrics({
    acceptedCandidateCount,
    editableHealLayerCount,
    generatedHealLayerCount: generatedHealLayers.length,
    meanAcceptedConfidence:
      acceptedCandidateCount === 0 ? null : Number((acceptedConfidenceTotal / acceptedCandidateCount).toFixed(4)),
    pendingCandidateCount,
    rejectedCandidateCount,
    runtimeProofStatus: generatedHealLayers.length === 0 ? 'needs_accepted_corrections' : 'needs_real_raw_output_proof',
    sourceReadyCount,
    unresolvedSourceCount: generatedHealLayers.length - sourceReadyCount,
  });
};
