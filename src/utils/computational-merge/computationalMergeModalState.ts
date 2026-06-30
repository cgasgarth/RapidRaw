import type { HdrModalState, PanoramaModalState } from '../../store/useUIStore';
import { getComputationalMergeAppServerRoutePairSummary } from './computationalMergeAppServerRoutePairs';

export const buildPanoramaDryRunCommandState = (
  paths: string[],
  settings: PanoramaModalState['settings'],
): NonNullable<PanoramaModalState['lastDryRunCommand']> => ({
  appServerToolName: getComputationalMergeAppServerRoutePairSummary('panorama').dryRunToolName,
  boundaryMode: settings.boundaryMode,
  commandType: 'computationalMerge.createPanorama',
  dryRun: true,
  maxPreviewDimensionPx: settings.maxPreviewDimensionPx,
  projection: settings.projection,
  sourceCount: paths.length,
});

export const buildPanoramaApplyCommandState = ({
  base64Length,
  sourceCount,
}: {
  base64Length: number;
  sourceCount: number;
}): NonNullable<PanoramaModalState['lastApplyCommand']> => ({
  acceptedDryRunPlanHash: `sha256:panorama-preview-${base64Length}`,
  acceptedDryRunPlanId: `panorama_plan_${sourceCount}`,
  commandType: 'computationalMerge.createPanorama',
  dryRun: false,
  sourceCount,
  toolName: getComputationalMergeAppServerRoutePairSummary('panorama').applyToolName,
});

export const resetPanoramaStateForSettingsChange = (
  state: PanoramaModalState,
  settings: PanoramaModalState['settings'],
): PanoramaModalState => ({
  ...state,
  error: null,
  finalImageBase64: null,
  lastApplyCommand: null,
  lastDryRunCommand: null,
  progressMessage: null,
  renderedReview: null,
  runtimePlan: null,
  settings,
});

export const buildHdrDryRunActionState = (
  paths: string[],
  settings: HdrModalState['settings'],
): {
  lastDryRunCommand: NonNullable<HdrModalState['lastDryRunCommand']>;
  selectedPaths: string[];
} => {
  const selectedIndexSet = new Set(settings.selectedSourceIndexes);
  const selectedPaths = paths.filter((_path, sourceIndex) => selectedIndexSet.has(sourceIndex));

  return {
    lastDryRunCommand: {
      toolName: getComputationalMergeAppServerRoutePairSummary('hdr').dryRunToolName,
      commandType: 'computationalMerge.createHdr',
      deghosting: settings.deghosting,
      dryRun: true,
      exposureWeightingMode: settings.exposureWeightingMode,
      maxPreviewDimensionPx: settings.maxPreviewDimensionPx,
      mergeStrategy: settings.mergeStrategy,
      selectedSourceIndexes: settings.selectedSourceIndexes,
      sources: selectedPaths.length,
      toneMappingPreset: settings.toneMappingPreset,
    },
    selectedPaths,
  };
};

export const buildHdrApplyCommandState = ({
  base64Length,
  sourceCount,
}: {
  base64Length: number;
  sourceCount: number;
}): NonNullable<HdrModalState['lastApplyCommand']> => ({
  acceptedDryRunPlanHash: `sha256:hdr-preview-${base64Length}`,
  acceptedDryRunPlanId: `hdr_plan_${sourceCount}`,
  commandType: 'computationalMerge.createHdr',
  dryRun: false,
  sources: sourceCount,
  toolName: getComputationalMergeAppServerRoutePairSummary('hdr').applyToolName,
});

export const resetHdrStateForSettingsChange = (
  state: HdrModalState,
  settings: HdrModalState['settings'],
): HdrModalState => {
  const {
    lastApplyCommand: _lastApplyCommand,
    lastDryRunCommand: _lastDryRunCommand,
    savedHandoffSummary: _savedHandoffSummary,
    ...rest
  } = state;

  return {
    ...rest,
    error: null,
    finalImageBase64: null,
    progressMessage: null,
    savedHandoffSummary: null,
    settings,
  };
};
