import { deriveArtifactInvalidationReasons } from '../../packages/rawengine-schema/src/derivedArtifactInvalidation';
import {
  derivedOutputReceiptSchema,
  type DerivedOutputReceipt,
  type DerivedOutputStaleReason,
} from '../schemas/derivedOutputReceiptSchemas';

import type { FocusStackOutputReviewWorkflow } from '../schemas/focusStackOutputReviewSchemas';
import type { FocusStackUiSettings } from '../schemas/focusStackUiSchemas';
import type { HdrEditableHandoffSummary, HdrMergeUiSettings } from '../schemas/hdrMergeUiSchemas';
import type { PanoramaSavedReviewSummary, PanoramaUiSettings } from '../schemas/panoramaUiSchemas';
import type { SuperResolutionOutputReviewWorkflow } from '../schemas/superResolutionOutputReviewSchemas';
import type { SuperResolutionUiSettings } from '../schemas/superResolutionUiSchemas';

type BuildReceiptInput = Omit<DerivedOutputReceipt, 'receiptId' | 'settingsHash'> & {
  settings: unknown;
};

const STALE_REASON_ORDER: ReadonlyArray<DerivedOutputStaleReason> = [
  'source_set_changed',
  'source_order_changed',
  'source_content_hash_changed',
  'source_graph_revision_changed',
  'settings_hash_changed',
  'recipe_hash_changed',
  'accepted_dry_run_plan_changed',
  'output_artifact_changed',
];

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

export const deriveDerivedOutputReceiptState = ({
  current,
  receipt,
}: {
  current: DerivedOutputReceipt;
  receipt: DerivedOutputReceipt;
}): DerivedOutputReceipt => {
  const reasons = new Set<DerivedOutputStaleReason>(
    deriveArtifactInvalidationReasons(
      {
        outputArtifact: {
          contentHash: receipt.outputContentHash,
        },
        sourceState: toSourceState(receipt),
      },
      {
        outputContentHash: current.outputContentHash,
        sourceState: toSourceState(current),
      },
    ),
  );

  if (receipt.sourceContentHashes.join('\n') !== current.sourceContentHashes.join('\n')) {
    reasons.add(receipt.sourceCount === current.sourceCount ? 'source_order_changed' : 'source_set_changed');
  }
  if (receipt.sourceGraphRevisions.join('\n') !== current.sourceGraphRevisions.join('\n')) {
    reasons.add(receipt.sourceCount === current.sourceCount ? 'source_order_changed' : 'source_set_changed');
  }
  if (receipt.settingsHash !== current.settingsHash) reasons.add('settings_hash_changed');
  if (receipt.recipeHash !== current.recipeHash) reasons.add('recipe_hash_changed');
  if (
    receipt.acceptedDryRunPlanHash !== current.acceptedDryRunPlanHash ||
    receipt.acceptedDryRunPlanId !== current.acceptedDryRunPlanId
  ) {
    reasons.add('accepted_dry_run_plan_changed');
  }

  const staleReasons = STALE_REASON_ORDER.filter((reason) => reasons.has(reason));
  return derivedOutputReceiptSchema.parse({
    ...receipt,
    staleReasons: staleReasons.length > 0 ? staleReasons : undefined,
    staleState: staleReasons.length > 0 ? 'stale' : receipt.staleState === 'unknown' ? 'unknown' : 'current',
  });
};

const toSourceState = (receipt: DerivedOutputReceipt) =>
  receipt.sourceContentHashes.map((contentHash, sourceIndex) => ({
    contentHash,
    graphRevision: receipt.sourceGraphRevisions[sourceIndex] ?? '',
    sourceIndex,
  }));

export const buildHdrDerivedOutputReceipt = ({
  acceptedDryRunPlanHash,
  acceptedDryRunPlanId,
  handoff,
  settings,
}: {
  acceptedDryRunPlanHash?: string | undefined;
  acceptedDryRunPlanId?: string | undefined;
  handoff: HdrEditableHandoffSummary;
  settings: HdrMergeUiSettings;
}): DerivedOutputReceipt =>
  buildDerivedOutputReceipt({
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId,
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
    staleReasons: undefined,
    staleState: 'current',
    storagePolicy: 'export_path',
  });

export const buildPanoramaDerivedOutputReceipt = ({
  acceptedDryRunPlanHash,
  acceptedDryRunPlanId,
  review,
  settings,
}: {
  acceptedDryRunPlanHash?: string | undefined;
  acceptedDryRunPlanId?: string | undefined;
  review: PanoramaSavedReviewSummary;
  settings: PanoramaUiSettings;
}): DerivedOutputReceipt =>
  buildDerivedOutputReceipt({
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId,
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
    sourceContentHashes: review.sourceRefs.map((source) => source.contentHash),
    sourceCount: review.sourceCount,
    sourceGraphRevisions: review.sourceRefs.map((source) => source.graphRevision),
    staleReasons: undefined,
    staleState: 'current',
    storagePolicy: 'export_path',
  });

export const buildFocusStackDerivedOutputReceipt = ({
  acceptedDryRunPlanHash,
  acceptedDryRunPlanId,
  review,
  settings,
}: {
  acceptedDryRunPlanHash?: string | undefined;
  acceptedDryRunPlanId?: string | undefined;
  review: FocusStackOutputReviewWorkflow;
  settings: FocusStackUiSettings;
}): DerivedOutputReceipt =>
  buildDerivedOutputReceipt({
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId,
    family: 'focus_stack',
    openInEditorAction: {
      label: 'Open focus stack output',
      state: review.editableHandoff.status === 'ready' ? 'deferred' : 'unavailable',
    },
    outputArtifactId: review.editableHandoff.artifactId,
    outputContentHash: review.editableHandoff.artifactHash,
    settings,
    sourceContentHashes: review.sourceRefs.map((source) => source.contentHash),
    sourceCount: review.sourceCount,
    sourceGraphRevisions: review.sourceRefs.map((source) => source.graphRevision),
    staleReasons: undefined,
    staleState: 'unknown',
    storagePolicy: 'sidecar_artifact',
  });

export const buildSuperResolutionDerivedOutputReceipt = ({
  acceptedDryRunPlanHash,
  acceptedDryRunPlanId,
  review,
  settings,
}: {
  acceptedDryRunPlanHash?: string | undefined;
  acceptedDryRunPlanId?: string | undefined;
  review: SuperResolutionOutputReviewWorkflow;
  settings: SuperResolutionUiSettings;
}): DerivedOutputReceipt =>
  buildDerivedOutputReceipt({
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId,
    family: 'super_resolution',
    openInEditorAction: {
      label: 'Open super-resolution output',
      path: review.editableGate === 'ready' ? review.artifactPath : undefined,
      state: review.editableGate === 'ready' ? 'available' : 'unavailable',
    },
    outputArtifactId: review.outputArtifactId,
    outputContentHash: review.outputArtifactHash,
    outputPath: review.editableGate === 'ready' ? review.artifactPath : undefined,
    settings,
    sourceContentHashes: review.sourceRefs.map((source) => source.contentHash),
    sourceCount: review.sourceCount,
    sourceGraphRevisions: review.sourceRefs.map((source) => source.graphRevision),
    staleReasons: undefined,
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
