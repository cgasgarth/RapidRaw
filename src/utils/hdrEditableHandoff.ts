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
  outputPath,
  settings,
  sourcePaths,
}: {
  outputPath: string;
  settings: HdrMergeUiSettings;
  sourcePaths: string[];
}): HdrEditableHandoffSummary =>
  hdrEditableHandoffSummarySchema.parse({
    capabilityLevel: 'runtime_apply_capable',
    editableDerivedAssetId: normalizeAssetId(outputPath),
    mergeStrategy: settings.mergeStrategy,
    outputColorSpace: 'srgb_display_referred_v1',
    outputEncoding: 'display_referred_preview',
    outputPath,
    previewToneMapped: settings.toneMapPreview,
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
