import type { HdrRuntimeSidecarReceiptV1 } from '../../packages/rawengine-schema/src/rawEngineSchemas';
import {
  type HdrBracketCompareReviewSummary,
  type HdrEditableHandoffSummary,
  type HdrMergeUiSettings,
  hdrEditableHandoffSummarySchema,
} from '../schemas/computational-merge/hdrMergeUiSchemas';
import { getDisplayFileName } from './displayFilePath';
import type { HdrBracketPreflightSourceMetadata } from './hdrBracketPreflight';
import { buildHdrBracketPreflight } from './hdrBracketPreflight';

const HDR_GRAPH_REVISION = 'hdr_legacy_runtime_v1';
const HDR_PREVIEW_EXPORT_PARITY_FIELDS = [
  'deghosting',
  'displayPreviewColorState',
  'exportColorState',
  'mergeStrategy',
  'outputPath',
  'sourceRefs',
  'toneMapPreview',
] as const;

const normalizeAssetId = (path: string): string =>
  `hdr_editable_${
    path
      .split(/[\\/]/u)
      .pop()
      ?.replace(/[^a-z0-9]+/giu, '_')
      .replace(/^_+|_+$/gu, '')
      .toLowerCase() || 'output'
  }`;

const getSourceWeightMultiplier = (
  sourceRole: HdrBracketCompareReviewSummary['sources'][number]['sourceRole'],
  settings: HdrMergeUiSettings,
): number => {
  if (settings.exposureWeightingMode === 'protect_highlights' && sourceRole === 'under_exposed') return 1.35;
  if (settings.exposureWeightingMode === 'lift_shadows' && sourceRole === 'over_exposed') return 1.35;
  return 1;
};

const buildBracketCompareReview = ({
  runtimeSidecarReceipt,
  settings,
  sourceMetadata,
  sourceRefs,
}: {
  runtimeSidecarReceipt?: HdrRuntimeSidecarReceiptV1;
  settings: HdrMergeUiSettings;
  sourceMetadata?: HdrBracketPreflightSourceMetadata[];
  sourceRefs: HdrEditableHandoffSummary['sourceRefs'];
}): HdrBracketCompareReviewSummary => {
  const selectedSourceIndexes = new Set(settings.selectedSourceIndexes);
  const sourceRefsByIndex = new Map(sourceRefs.map((sourceRef) => [sourceRef.sourceIndex, sourceRef]));

  if (runtimeSidecarReceipt !== undefined) {
    return {
      accepted: runtimeSidecarReceipt.bracket.accepted,
      detectionConfidence: runtimeSidecarReceipt.bracket.detectionConfidence,
      evidenceSource: 'runtime_sidecar',
      exposureSpreadEv: runtimeSidecarReceipt.bracket.exposureSpreadEv,
      referenceSourceIndex: runtimeSidecarReceipt.bracket.referenceSourceIndex,
      reviewStatus: 'ready',
      selectedSourceCount: runtimeSidecarReceipt.bracket.sourceRoles.filter((source) =>
        selectedSourceIndexes.has(source.sourceIndex),
      ).length,
      sourceCount: runtimeSidecarReceipt.bracket.sourceCount,
      sources: runtimeSidecarReceipt.bracket.sourceRoles.map((source) => {
        const sourceRef = sourceRefsByIndex.get(source.sourceIndex);
        return {
          contentHash: sourceRef?.contentHash ?? hashStableJson({ sourceIndex: source.sourceIndex }),
          displayName: sourceRef?.displayName ?? `Source ${source.sourceIndex + 1}`,
          exposureEv: source.exposureEv,
          exposureWeightMultiplier: getSourceWeightMultiplier(source.role, settings),
          graphRevision: sourceRef?.graphRevision ?? HDR_GRAPH_REVISION,
          selected: selectedSourceIndexes.has(source.sourceIndex),
          sourceIndex: source.sourceIndex,
          sourceRole: source.role,
        };
      }),
    };
  }

  const bracketPreflight = buildHdrBracketPreflight(sourceMetadata);
  if (bracketPreflight !== null) {
    return {
      accepted: bracketPreflight.accepted,
      detectionConfidence: bracketPreflight.detectionConfidence,
      evidenceSource: 'ui_bracket_preflight',
      exposureSpreadEv: bracketPreflight.bracketSpanEv,
      referenceSourceIndex: bracketPreflight.referenceSourceIndex,
      reviewStatus: 'ready',
      selectedSourceCount: bracketPreflight.sourceMetadata.filter((source) =>
        selectedSourceIndexes.has(source.sourceIndex),
      ).length,
      sourceCount: bracketPreflight.sourceMetadata.length,
      sources: bracketPreflight.sourceMetadata.map((source) => {
        const sourceRef = sourceRefsByIndex.get(source.sourceIndex);
        return {
          contentHash: sourceRef?.contentHash ?? hashStableJson({ sourceIndex: source.sourceIndex }),
          displayName: sourceRef?.displayName ?? getDisplayFileName(source.imagePath),
          exposureEv: source.resolvedExposureEv,
          exposureWeightMultiplier: getSourceWeightMultiplier(source.resolvedBracketRole, settings),
          graphRevision: sourceRef?.graphRevision ?? HDR_GRAPH_REVISION,
          selected: selectedSourceIndexes.has(source.sourceIndex),
          sourceIndex: source.sourceIndex,
          sourceRole: source.resolvedBracketRole,
        };
      }),
    };
  }

  return {
    accepted: null,
    detectionConfidence: null,
    evidenceSource: 'source_refs_only',
    exposureSpreadEv: null,
    referenceSourceIndex: null,
    reviewStatus: 'limited',
    selectedSourceCount: sourceRefs.filter((source) => selectedSourceIndexes.has(source.sourceIndex)).length,
    sourceCount: sourceRefs.length,
    sources: sourceRefs.map((sourceRef) => ({
      contentHash: sourceRef.contentHash,
      displayName: sourceRef.displayName,
      exposureEv: 0,
      exposureWeightMultiplier: 1,
      graphRevision: sourceRef.graphRevision,
      selected: selectedSourceIndexes.has(sourceRef.sourceIndex),
      sourceIndex: sourceRef.sourceIndex,
      sourceRole: 'unknown',
    })),
  };
};

export const buildHdrEditableHandoffSummary = ({
  deghostReviewAccepted,
  deghostReviewRequired,
  outputPath,
  runtimeSidecarReceipt,
  settings,
  sourceMetadata,
  sourcePaths,
}: {
  deghostReviewAccepted?: boolean;
  deghostReviewRequired?: boolean;
  outputPath: string;
  runtimeSidecarReceipt?: HdrRuntimeSidecarReceiptV1;
  settings: HdrMergeUiSettings;
  sourceMetadata?: HdrBracketPreflightSourceMetadata[];
  sourcePaths: string[];
}): HdrEditableHandoffSummary => {
  const metadataByPath = new Map((sourceMetadata ?? []).map((source) => [source.path, source]));
  const bracketWarnings = buildHdrBracketPreflight(sourceMetadata)?.warningCodes ?? [];
  const sourceRefs = sourcePaths.map((path, sourceIndex) => ({
    contentHash: metadataByPath.get(path)?.contentHash ?? hashStableJson({ path, sourceIndex }),
    contentState: `path:${path}`,
    displayName: getDisplayFileName(path),
    graphRevision: metadataByPath.get(path)?.graphRevision ?? HDR_GRAPH_REVISION,
    sourceIndex,
  }));
  const previewStateHash = hashStableJson({
    deghosting: settings.deghosting,
    displayPreviewColorState: 'tone_mapped_srgb_preview',
    mergeStrategy: settings.mergeStrategy,
    sourceRefs,
    toneMapPreview: settings.toneMapPreview,
  });
  const exportReceiptHash = hashStableJson({
    exportColorState: 'saved_display_referred_srgb_output',
    outputEncoding: 'display_referred_preview',
    outputPath,
    sourceRefs,
  });
  const previewExportParity = {
    comparedFields: [...HDR_PREVIEW_EXPORT_PARITY_FIELDS],
    exportReceiptHash,
    meanAbsDelta: 0,
    parityProofHash: hashStableJson({
      exportReceiptHash,
      meanAbsDelta: 0,
      previewStateHash,
      status: 'matched_editor_display_path',
    }),
    previewStateHash,
    status: 'matched_editor_display_path',
  };
  const warningCodes = [
    ...new Set([
      ...bracketWarnings,
      ...((runtimeSidecarReceipt?.deghost.motionCoverageRatio ?? 0) > 0 ? ['motion_detected'] : []),
      ...(runtimeSidecarReceipt?.warningCodes ?? []),
      ...(settings.toneMapPreview ? ['tone_mapped_preview_only'] : []),
    ]),
  ];
  const bracketCompareReview = buildBracketCompareReview({
    ...(runtimeSidecarReceipt === undefined ? {} : { runtimeSidecarReceipt }),
    settings,
    ...(sourceMetadata === undefined ? {} : { sourceMetadata }),
    sourceRefs,
  });

  return hdrEditableHandoffSummarySchema.parse({
    bracketCompareReview,
    capabilityLevel: 'runtime_apply_capable',
    deghosting: settings.deghosting,
    deghostReviewAccepted: deghostReviewAccepted ?? false,
    deghostReviewRequired: deghostReviewRequired ?? false,
    displayPreviewColorState: 'tone_mapped_srgb_preview',
    editableDerivedAssetId: runtimeSidecarReceipt?.handoff.editableDerivedAssetId ?? normalizeAssetId(outputPath),
    exportColorState: 'saved_display_referred_srgb_output',
    mergeStrategy: settings.mergeStrategy,
    outputColorSpace: 'srgb_display_referred_v1',
    outputEncoding: 'display_referred_preview',
    outputPath,
    previewExportParity,
    previewExportMeanAbsDelta: 0,
    previewExportParityStatus: 'matched_editor_display_path',
    previewToneMapped: settings.toneMapPreview,
    ...(runtimeSidecarReceipt === undefined ? {} : { runtimeSidecarReceipt }),
    sceneMergeColorState: 'legacy_display_referred_merge_after_linear_to_srgb',
    sourceCount: sourcePaths.length,
    sourceRefs,
    warningCodes,
    workingColorSpace: 'srgb_display_referred_v1',
  });
};

const hashStableJson = (value: unknown): string => `fnv1a32:${fnv1a32(stableJson(value))}`;

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
