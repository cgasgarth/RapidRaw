import { derivedOutputReceiptSchema, type DerivedOutputReceipt } from '../schemas/derivedOutputReceiptSchemas';

import type { FocusStackOutputReviewWorkflow } from '../schemas/focusStackOutputReviewSchemas';
import type { FocusStackUiSettings } from '../schemas/focusStackUiSchemas';
import type { HdrEditableHandoffSummary, HdrMergeUiSettings } from '../schemas/hdrMergeUiSchemas';
import type { PanoramaSavedReviewSummary, PanoramaUiSettings } from '../schemas/panoramaUiSchemas';
import type { SuperResolutionOutputReviewWorkflow } from '../schemas/superResolutionOutputReviewSchemas';
import type { SuperResolutionUiSettings } from '../schemas/superResolutionUiSchemas';

type BuildReceiptInput = Omit<DerivedOutputReceipt, 'receiptId' | 'settingsHash'> & {
  settings: unknown;
};

export const buildDerivedOutputReceipt = (input: BuildReceiptInput): DerivedOutputReceipt => {
  const settingsHash = hashStableJson(input.settings);
  const { settings: _settings, ...receiptInput } = input;
  return derivedOutputReceiptSchema.parse({
    ...receiptInput,
    receiptId: `derived_output_${input.family}_${hashStableJson({
      family: input.family,
      outputArtifactId: input.outputArtifactId,
      outputContentHash: input.outputContentHash,
      settingsHash,
    }).replace(':', '_')}`,
    settingsHash,
  });
};

export const buildHdrDerivedOutputReceipt = ({
  handoff,
  settings,
}: {
  handoff: HdrEditableHandoffSummary;
  settings: HdrMergeUiSettings;
}): DerivedOutputReceipt =>
  buildDerivedOutputReceipt({
    family: 'hdr',
    openInEditorAction: {
      label: 'Open HDR output',
      path: handoff.outputPath,
      state: 'available',
    },
    outputArtifactId: handoff.editableDerivedAssetId,
    outputContentHash: handoff.previewExportParity.parityProofHash,
    outputPath: handoff.outputPath,
    settings,
    sourceContentHashes: handoff.sourceRefs.map((source) => hashStableJson(source.contentState)),
    sourceCount: handoff.sourceCount,
    sourceGraphRevisions: handoff.sourceRefs.map((source) => source.graphRevision),
    staleState: 'current',
    storagePolicy: 'export_path',
  });

export const buildPanoramaDerivedOutputReceipt = ({
  review,
  settings,
}: {
  review: PanoramaSavedReviewSummary;
  settings: PanoramaUiSettings;
}): DerivedOutputReceipt =>
  buildDerivedOutputReceipt({
    family: 'panorama',
    openInEditorAction: {
      label: 'Open panorama output',
      path: review.outputPath,
      state: 'available',
    },
    outputArtifactId: `artifact_panorama_${hashStableJson(review.outputPath).replace(':', '_')}`,
    outputContentHash: hashStableJson({
      boundaryMode: review.boundaryMode,
      crop: review.crop,
      outputDimensions: review.outputDimensions,
      outputPath: review.outputPath,
      projection: review.projection,
      seamReview: review.seamReview,
    }),
    outputPath: review.outputPath,
    settings,
    sourceContentHashes: Array.from({ length: review.sourceCount }, (_value, sourceIndex) =>
      hashStableJson({ outputPath: review.outputPath, sourceIndex, sourceContribution: review.sourceContribution }),
    ),
    sourceCount: review.sourceCount,
    sourceGraphRevisions: Array.from(
      { length: review.sourceCount },
      (_value, sourceIndex) => `panorama_source_${sourceIndex}`,
    ),
    staleState: 'current',
    storagePolicy: 'export_path',
  });

export const buildFocusStackDerivedOutputReceipt = ({
  review,
  settings,
}: {
  review: FocusStackOutputReviewWorkflow;
  settings: FocusStackUiSettings;
}): DerivedOutputReceipt =>
  buildDerivedOutputReceipt({
    family: 'focus_stack',
    openInEditorAction: {
      label: 'Open focus stack output',
      state: review.editableHandoff.status === 'ready' ? 'deferred' : 'unavailable',
    },
    outputArtifactId: review.editableHandoff.artifactId,
    outputContentHash: review.editableHandoff.artifactHash,
    settings,
    sourceContentHashes: review.reviewOverlay.sourceContributionSummary.map((source) => hashStableJson(source)),
    sourceCount: review.sourceCount,
    sourceGraphRevisions: review.reviewOverlay.sourceContributionSummary.map(
      (source) => `focus_stack_source_${source.sourceIndex}`,
    ),
    staleState: 'unknown',
    storagePolicy: 'sidecar_artifact',
  });

export const buildSuperResolutionDerivedOutputReceipt = ({
  review,
  settings,
}: {
  review: SuperResolutionOutputReviewWorkflow;
  settings: SuperResolutionUiSettings;
}): DerivedOutputReceipt =>
  buildDerivedOutputReceipt({
    family: 'super_resolution',
    openInEditorAction: {
      label: 'Open super-resolution output',
      state: review.editableGate === 'ready' ? 'deferred' : 'unavailable',
    },
    outputArtifactId: review.outputArtifactId,
    outputContentHash: review.outputArtifactHash,
    settings,
    sourceContentHashes: Array.from({ length: review.sourceCount }, (_value, sourceIndex) =>
      hashStableJson({ sourceIndex, supportMap: review.supportMap, outputArtifactId: review.outputArtifactId }),
    ),
    sourceCount: review.sourceCount,
    sourceGraphRevisions: Array.from(
      { length: review.sourceCount },
      (_value, sourceIndex) => `sr_source_${sourceIndex}`,
    ),
    staleState: review.staleState,
    storagePolicy: 'sidecar_artifact',
  });

export const hashStableJson = (value: unknown): string => `fnv1a32:${fnv1a32(stableJson(value))}`;

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
