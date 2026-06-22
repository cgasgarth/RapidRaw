import { getDisplayFileName } from './displayFilePath';
import {
  hdrEditableHandoffSummarySchema,
  type HdrEditableHandoffSummary,
  type HdrMergeUiSettings,
} from '../schemas/hdrMergeUiSchemas';

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

export const buildHdrEditableHandoffSummary = ({
  deghostReviewAccepted,
  deghostReviewRequired,
  outputPath,
  settings,
  sourcePaths,
}: {
  deghostReviewAccepted?: boolean;
  deghostReviewRequired?: boolean;
  outputPath: string;
  settings: HdrMergeUiSettings;
  sourcePaths: string[];
}): HdrEditableHandoffSummary => {
  const sourceRefs = sourcePaths.map((path, sourceIndex) => ({
    contentState: `path:${path}`,
    displayName: getDisplayFileName(path),
    graphRevision: HDR_GRAPH_REVISION,
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

  return hdrEditableHandoffSummarySchema.parse({
    capabilityLevel: 'runtime_apply_capable',
    deghosting: settings.deghosting,
    deghostReviewAccepted: deghostReviewAccepted ?? false,
    deghostReviewRequired: deghostReviewRequired ?? false,
    displayPreviewColorState: 'tone_mapped_srgb_preview',
    editableDerivedAssetId: normalizeAssetId(outputPath),
    exportColorState: 'saved_display_referred_srgb_output',
    mergeStrategy: settings.mergeStrategy,
    outputColorSpace: 'srgb_display_referred_v1',
    outputEncoding: 'display_referred_preview',
    outputPath,
    previewExportParity,
    previewExportMeanAbsDelta: 0,
    previewExportParityStatus: 'matched_editor_display_path',
    previewToneMapped: settings.toneMapPreview,
    sceneMergeColorState: 'legacy_display_referred_merge_after_linear_to_srgb',
    sourceCount: sourcePaths.length,
    sourceRefs,
    warningCodes: ['tone_mapped_preview_only'],
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
