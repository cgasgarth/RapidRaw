import { DEFAULT_LAYER_BLEND_MODE, INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from './adjustments';
import { Mask, SubMaskMode } from '../components/panel/right/Masks';

import type { NegativeLabDustScratchReviewReport } from '../schemas/negativeLabWorkspaceSchemas';

type DustScratchFrame = NegativeLabDustScratchReviewReport['frames'][number];
type DustScratchCandidate = DustScratchFrame['candidates'][number];

interface DustCandidateHealLayerInput {
  candidate: DustScratchCandidate;
  frameId: string;
  imageHeight: number;
  imageWidth: number;
  layerId?: string;
  targetSubMaskId?: string;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const buildDustCandidateHealLayer = ({
  candidate,
  frameId,
  imageHeight,
  imageWidth,
  layerId,
  targetSubMaskId,
}: DustCandidateHealLayerInput): MaskContainer => {
  if (candidate.kind !== 'dust_spot') {
    throw new Error('Only dust spot candidates can be converted into heal layers.');
  }

  const targetX = clamp01(candidate.geometry.x + candidate.geometry.width / 2);
  const targetY = clamp01(candidate.geometry.y + candidate.geometry.height / 2);
  const sourceOffsetX = Math.max(candidate.geometry.width * 2.5, 0.04);
  const sourceX = clamp01(targetX + sourceOffsetX <= 1 ? targetX + sourceOffsetX : targetX - sourceOffsetX);
  const sourceY = targetY;
  const radiusPx = Math.max(
    2,
    (Math.max(candidate.geometry.width * imageWidth, candidate.geometry.height * imageHeight) / 2) * 1.45,
  );
  const featherRadiusPx = Math.max(1, radiusPx * 0.35);

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
        candidateId: candidate.candidateId,
        candidateKind: candidate.kind,
        confidence: candidate.confidence,
        confidenceSemantics: 'ranking_score_v1',
        origin: 'negative_lab_dust_candidate',
        sourceFrameId: frameId,
        statusAtAcceptance: candidate.status,
      },
      featherRadiusPx,
      radiusPx,
      retouchMode: 'heal',
      rotationDegrees: 0,
      scale: 1,
      sourcePoint: { x: sourceX, y: sourceY },
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
