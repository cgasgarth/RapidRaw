import type { MatchLookApplicationReceiptV1 } from '../../packages/rawengine-schema/src/referenceMatchRuntime';
import { matchLookProposalV1Schema } from '../../packages/rawengine-schema/src/referenceMatchRuntime';
import {
  type Adjustments,
  DEFAULT_LAYER_BLEND_MODE,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from './adjustments';

export type ReferenceMatchMode = 'match-look' | 'normalize';
export type ReferenceMatchGroup = 'color' | 'presence' | 'tone';

export interface ReferenceHistogramSummary {
  analysisBasis: 'color-managed-editor-preview';
  blueMean: number;
  clippedFraction: number;
  greenMean: number;
  lumaMean: number;
  lumaSpread: number;
  redMean: number;
  sampleCount: number;
  spatialTiles: ReferenceSpatialTileSummary[];
}

export interface ReferenceSpatialTileSummary {
  blueMean: number;
  clippedFraction: number;
  greenMean: number;
  lumaMean: number;
  lumaSpread: number;
  redMean: number;
  sampleCount: number;
  x: number;
  y: number;
}

export interface ReferenceSpatialAnalysis {
  frameId: { graphRevision: number; imageSession: number; previewGeneration: number };
  gridHeight: number;
  gridWidth: number;
  path: string;
  tiles: ReferenceSpatialTileSummary[];
}

export interface ReferenceMatchReference {
  adjustmentRevision: number;
  cameraProfile: string;
  geometryFingerprint: string;
  geometryRevision: number;
  graphFingerprint: string;
  id: string;
  label: string;
  path: string;
  proofFingerprint: string;
  proofRevision: number;
  renderUrl: string;
  sourceFingerprint: string;
  summary: ReferenceHistogramSummary;
  viewFingerprint: string;
  weight: number;
}

export type ReferenceMatchAdjustmentKey =
  | 'contrast'
  | 'creativeTemperature'
  | 'creativeTint'
  | 'exposure'
  | 'saturation'
  | 'vibrance';

export interface ReferenceMatchDiff {
  current: number;
  group: ReferenceMatchGroup;
  key: ReferenceMatchAdjustmentKey;
  proposed: number;
}

export interface ReferenceMatchProposal {
  confidence: number;
  diffs: ReferenceMatchDiff[];
  effectiveReferences: Array<{ sourceFingerprint: string; weight: number }>;
  mode: ReferenceMatchMode;
  processVersion: 'rapidraw-reference-match-v1';
  proposalFingerprint: string;
  residualAfter: number;
  residualBefore: number;
  schemaVersion: 1;
  targetAnalysisFingerprint: string;
  warnings: string[];
}

export interface ReferenceMatchPreviewCandidate {
  adjustments: Adjustments;
  baseAdjustmentRevision: number;
  targetPath: string;
}

const REFERENCE_MATCH_LAYER_KEYS = new Set<ReferenceMatchAdjustmentKey>(['exposure', 'contrast', 'saturation']);

export interface ReferenceMatchLayerCompatibility {
  supported: boolean;
  unsupportedKeys: ReferenceMatchAdjustmentKey[];
}

export const getReferenceMatchLayerCompatibility = (
  proposal: ReferenceMatchProposal,
  enabledGroups: ReadonlySet<ReferenceMatchGroup>,
): ReferenceMatchLayerCompatibility => {
  const unsupportedKeys = proposal.diffs
    .filter((diff) => enabledGroups.has(diff.group) && !REFERENCE_MATCH_LAYER_KEYS.has(diff.key))
    .map((diff) => diff.key);
  return { supported: unsupportedKeys.length === 0, unsupportedKeys };
};

export const createReferenceMatchAdjustmentLayer = ({
  enabledGroups,
  id,
  impact,
  name,
  proposal,
  receipt,
}: {
  enabledGroups: ReadonlySet<ReferenceMatchGroup>;
  id: string;
  impact: number;
  name: string;
  proposal: ReferenceMatchProposal;
  receipt?: MatchLookApplicationReceiptV1;
}): MaskContainer => {
  const compatibility = getReferenceMatchLayerCompatibility(proposal, enabledGroups);
  if (!compatibility.supported) {
    throw new Error(`Layer destination does not support: ${compatibility.unsupportedKeys.join(', ')}.`);
  }
  const amount = clamp(impact, 0, 100) / 100;
  const adjustments = structuredClone(INITIAL_MASK_ADJUSTMENTS);
  for (const diff of proposal.diffs) {
    if (!enabledGroups.has(diff.group)) continue;
    if (diff.key === 'exposure' || diff.key === 'contrast' || diff.key === 'saturation') {
      adjustments[diff.key] = (diff.proposed - diff.current) * amount;
    }
  }
  return {
    adjustments,
    blendMode: DEFAULT_LAYER_BLEND_MODE,
    id,
    invert: false,
    name,
    opacity: 100,
    ...(receipt === undefined ? {} : { referenceMatchApplicationReceipt: receipt }),
    subMasks: [],
    visible: true,
  };
};

interface HistogramChannel {
  data: number[] | undefined;
}

type MatchHistogram = Record<'blue' | 'green' | 'luma' | 'red', HistogramChannel>;

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

export const fingerprintReferenceMatchValue = (value: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
};

const channelMoments = (bins: number[] | undefined): { mean: number; spread: number; count: number } | null => {
  if (!bins || bins.length < 2) return null;
  const count = bins.reduce((sum, value) => sum + Math.max(0, finite(value)), 0);
  if (count <= 0) return null;
  const denominator = bins.length - 1;
  const mean = bins.reduce((sum, value, index) => sum + (index / denominator) * Math.max(0, finite(value)), 0) / count;
  const variance =
    bins.reduce((sum, value, index) => sum + (index / denominator - mean) ** 2 * Math.max(0, finite(value)), 0) / count;
  return { count, mean, spread: Math.sqrt(variance) };
};

export const summarizeReferenceHistogram = (
  histogram: MatchHistogram | null,
  spatial: ReferenceSpatialAnalysis | null = null,
): ReferenceHistogramSummary | null => {
  if (!histogram) return null;
  const lumaBins = histogram.luma.data;
  const luma = channelMoments(lumaBins);
  const red = channelMoments(histogram.red.data);
  const green = channelMoments(histogram.green.data);
  const blue = channelMoments(histogram.blue.data);
  if (!luma || !red || !green || !blue) return null;
  return {
    analysisBasis: 'color-managed-editor-preview',
    blueMean: blue.mean,
    clippedFraction: ((lumaBins?.[0] ?? 0) + (lumaBins?.[lumaBins.length - 1] ?? 0)) / luma.count,
    greenMean: green.mean,
    lumaMean: luma.mean,
    lumaSpread: luma.spread,
    redMean: red.mean,
    sampleCount: Math.min(luma.count, red.count, green.count, blue.count),
    spatialTiles: spatial?.tiles ?? [],
  };
};

export const combineReferenceSummaries = (
  references: readonly ReferenceMatchReference[],
): ReferenceHistogramSummary | null => {
  const valid = references.filter((reference) => reference.weight > 0);
  const totalWeight = valid.reduce((sum, reference) => sum + reference.weight, 0);
  if (valid.length === 0 || totalWeight <= 0) return null;
  const weighted = (select: (summary: ReferenceHistogramSummary) => number): number =>
    valid.reduce((sum, reference) => sum + select(reference.summary) * reference.weight, 0) / totalWeight;
  return {
    analysisBasis: 'color-managed-editor-preview',
    blueMean: weighted((summary) => summary.blueMean),
    clippedFraction: weighted((summary) => summary.clippedFraction),
    greenMean: weighted((summary) => summary.greenMean),
    lumaMean: weighted((summary) => summary.lumaMean),
    lumaSpread: weighted((summary) => summary.lumaSpread),
    redMean: weighted((summary) => summary.redMean),
    sampleCount: Math.round(weighted((summary) => summary.sampleCount)),
    spatialTiles: valid.every(
      (reference) => reference.summary.spatialTiles.length === valid[0]?.summary.spatialTiles.length,
    )
      ? (valid[0]?.summary.spatialTiles.map((tile, index) => ({
          ...tile,
          blueMean: weighted((summary) => summary.spatialTiles[index]?.blueMean ?? tile.blueMean),
          clippedFraction: weighted((summary) => summary.spatialTiles[index]?.clippedFraction ?? tile.clippedFraction),
          greenMean: weighted((summary) => summary.spatialTiles[index]?.greenMean ?? tile.greenMean),
          lumaMean: weighted((summary) => summary.spatialTiles[index]?.lumaMean ?? tile.lumaMean),
          lumaSpread: weighted((summary) => summary.spatialTiles[index]?.lumaSpread ?? tile.lumaSpread),
          redMean: weighted((summary) => summary.spatialTiles[index]?.redMean ?? tile.redMean),
          sampleCount: Math.round(weighted((summary) => summary.spatialTiles[index]?.sampleCount ?? tile.sampleCount)),
        })) ?? [])
      : [],
  };
};

const hasLocalizedMismatch = (target: ReferenceHistogramSummary, reference: ReferenceHistogramSummary): boolean => {
  if (target.spatialTiles.length < 4 || target.spatialTiles.length !== reference.spatialTiles.length) return false;
  const deltas = target.spatialTiles.map(
    (tile, index) => (reference.spatialTiles[index]?.lumaMean ?? 0) - tile.lumaMean,
  );
  const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  const disagreement = deltas.reduce((sum, value) => sum + Math.abs(value - mean), 0) / deltas.length;
  return disagreement > Math.max(0.06, Math.abs(mean) * 1.25);
};

const colorfulness = (summary: ReferenceHistogramSummary): number =>
  Math.abs(summary.redMean - summary.greenMean) +
  Math.abs(summary.greenMean - summary.blueMean) +
  Math.abs(summary.blueMean - summary.redMean);

const summaryDistance = (target: ReferenceHistogramSummary, reference: ReferenceHistogramSummary): number =>
  Math.abs(Math.log2((reference.lumaMean + 1 / 255) / (target.lumaMean + 1 / 255))) +
  Math.abs(reference.lumaSpread - target.lumaSpread) * 2 +
  Math.abs(reference.redMean - target.redMean) +
  Math.abs(reference.greenMean - target.greenMean) +
  Math.abs(reference.blueMean - target.blueMean);

export const createReferenceMatchProposal = ({
  adjustments,
  mode,
  references,
  target,
  targetProfile,
  targetProofFingerprint,
}: {
  adjustments: Adjustments;
  mode: ReferenceMatchMode;
  references: readonly ReferenceMatchReference[];
  target: ReferenceHistogramSummary;
  targetProfile?: string;
  targetProofFingerprint?: string;
}): ReferenceMatchProposal | null => {
  const reference = combineReferenceSummaries(references);
  if (!reference) return null;
  const exposureDelta = clamp(Math.log2((reference.lumaMean + 1 / 255) / (target.lumaMean + 1 / 255)), -2, 2);
  const contrastDelta = clamp((reference.lumaSpread - target.lumaSpread) * 180, -35, 35);
  const diffs: ReferenceMatchDiff[] = [
    {
      current: adjustments.exposure,
      group: 'tone',
      key: 'exposure',
      proposed: clamp(adjustments.exposure + exposureDelta, -5, 5),
    },
    {
      current: adjustments.contrast,
      group: 'tone',
      key: 'contrast',
      proposed: clamp(adjustments.contrast + contrastDelta, -100, 100),
    },
  ];
  if (mode === 'match-look') {
    diffs.push(
      {
        current: adjustments.creativeTemperature,
        group: 'color',
        key: 'creativeTemperature',
        proposed: clamp(
          adjustments.creativeTemperature +
            (reference.redMean - reference.blueMean - (target.redMean - target.blueMean)) * 100,
          -100,
          100,
        ),
      },
      {
        current: adjustments.creativeTint,
        group: 'color',
        key: 'creativeTint',
        proposed: clamp(
          adjustments.creativeTint +
            (reference.greenMean -
              (reference.redMean + reference.blueMean) / 2 -
              (target.greenMean - (target.redMean + target.blueMean) / 2)) *
              100,
          -100,
          100,
        ),
      },
      {
        current: adjustments.saturation,
        group: 'presence',
        key: 'saturation',
        proposed: clamp(adjustments.saturation + (colorfulness(reference) - colorfulness(target)) * 100, -100, 100),
      },
      {
        current: adjustments.vibrance,
        group: 'presence',
        key: 'vibrance',
        proposed: clamp(adjustments.vibrance + (colorfulness(reference) - colorfulness(target)) * 50, -100, 100),
      },
    );
  }
  const residualBefore = summaryDistance(target, reference);
  const predicted = { ...target };
  predicted.lumaMean = clamp(target.lumaMean * 2 ** exposureDelta, 0, 1);
  predicted.lumaSpread = clamp(target.lumaSpread + contrastDelta / 180, 0, 0.5);
  if (mode === 'match-look') {
    const temperatureDelta = reference.redMean - reference.blueMean - (target.redMean - target.blueMean);
    const tintDelta =
      reference.greenMean -
      (reference.redMean + reference.blueMean) / 2 -
      (target.greenMean - (target.redMean + target.blueMean) / 2);
    predicted.redMean = clamp(target.redMean + temperatureDelta / 2, 0, 1);
    predicted.blueMean = clamp(target.blueMean - temperatureDelta / 2, 0, 1);
    predicted.greenMean = clamp(target.greenMean + tintDelta, 0, 1);
  }
  const residualAfter = summaryDistance(predicted, reference);
  const localizedMismatch = hasLocalizedMismatch(target, reference);
  const warnings = [
    ...(references.some((item) => item.path.length === 0) ? ['Reference source identity is incomplete.'] : []),
    ...(reference.clippedFraction > 0.02 || target.clippedFraction > 0.02
      ? ['Clipped histogram endpoints reduce match reliability.']
      : []),
    ...(targetProofFingerprint && references.some((item) => item.proofFingerprint !== targetProofFingerprint)
      ? ['Reference and target proof identities differ.']
      : []),
    ...(targetProfile && references.some((item) => item.cameraProfile !== targetProfile)
      ? ['Reference and target camera profiles differ; profile replacement is excluded.']
      : []),
    ...(target.sampleCount < 256 ? ['Target histogram has limited sample support.'] : []),
    ...(localizedMismatch
      ? ['Spatial tiles disagree with a global match; localized subject differences reduce reliability.']
      : target.spatialTiles.length === 0 || reference.spatialTiles.length === 0
        ? ['Spatial analysis is unavailable; inspect localized subject differences before apply.']
        : []),
  ];
  const recommendedDiffs = diffs.filter((diff) => Math.abs(diff.proposed - diff.current) >= 0.005);
  if (recommendedDiffs.length === 0) return null;
  const effectiveReferences = references
    .filter((item) => item.weight > 0)
    .map((item) => ({ sourceFingerprint: item.sourceFingerprint, weight: item.weight }))
    .sort((left, right) => left.sourceFingerprint.localeCompare(right.sourceFingerprint));
  const targetAnalysisFingerprint = fingerprintReferenceMatchValue(JSON.stringify(target));
  const proposalFingerprint = fingerprintReferenceMatchValue(
    JSON.stringify({ diffs: recommendedDiffs, effectiveReferences, mode, targetAnalysisFingerprint }),
  );
  return matchLookProposalV1Schema.parse({
    confidence:
      clamp(Math.min(target.sampleCount, reference.sampleCount) / 4096, 0.2, 0.98) * (localizedMismatch ? 0.55 : 1),
    diffs: recommendedDiffs,
    effectiveReferences,
    mode,
    processVersion: 'rapidraw-reference-match-v1',
    proposalFingerprint,
    residualAfter,
    residualBefore,
    schemaVersion: 1,
    targetAnalysisFingerprint,
    warnings,
  });
};

export const applyReferenceMatchProposal = ({
  adjustments,
  enabledGroups,
  impact,
  proposal,
}: {
  adjustments: Adjustments;
  enabledGroups: ReadonlySet<ReferenceMatchGroup>;
  impact: number;
  proposal: ReferenceMatchProposal;
}): Adjustments => {
  const amount = clamp(impact, 0, 100) / 100;
  const next = { ...adjustments };
  for (const diff of proposal.diffs) {
    if (!enabledGroups.has(diff.group)) continue;
    next[diff.key] = diff.current + (diff.proposed - diff.current) * amount;
  }
  return next;
};

export const resolveReferenceMatchRenderAdjustments = ({
  adjustmentRevision,
  committed,
  preview,
  targetPath,
}: {
  adjustmentRevision: number;
  committed: Adjustments;
  preview: ReferenceMatchPreviewCandidate | null;
  targetPath: string | null;
}): Adjustments =>
  preview?.baseAdjustmentRevision === adjustmentRevision && preview.targetPath === targetPath
    ? preview.adjustments
    : committed;
