import { getDisplayFileName } from './displayFilePath';
import {
  hdrEditableHandoffSummarySchema,
  type HdrEditableHandoffSummary,
  type HdrMergeUiSettings,
} from '../schemas/hdrMergeUiSchemas';

const HDR_GRAPH_REVISION = 'hdr_legacy_runtime_v1';

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
}): HdrEditableHandoffSummary =>
  hdrEditableHandoffSummarySchema.parse({
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
    previewExportMeanAbsDelta: 0,
    previewExportParityStatus: 'matched_editor_display_path',
    previewToneMapped: settings.toneMapPreview,
    sceneMergeColorState: 'legacy_display_referred_merge_after_linear_to_srgb',
    sourceCount: sourcePaths.length,
    sourceRefs: sourcePaths.map((path, sourceIndex) => ({
      contentState: `path:${path}`,
      displayName: getDisplayFileName(path),
      graphRevision: HDR_GRAPH_REVISION,
      sourceIndex,
    })),
    warningCodes: ['tone_mapped_preview_only'],
    workingColorSpace: 'srgb_display_referred_v1',
  });
