import type { NegativeConversionModalState } from '../../store/useUIStore';
import { EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD } from './negativeLabPatchSamplerCorrections';
import { buildNegativeLabPlanHash } from './negativeLabPlanIdentity';
import { DEFAULT_NEGATIVE_LAB_UI_PRESET } from './negativeLabPresetCatalog';
import { createNegativeLabSessionState, reconcileNegativeLabSessionTargetPaths } from './negativeLabSessionState';

const DEFAULT_SAVE_OPTIONS = {
  outputFormat: 'tiff16',
  suffix: 'Positive',
  writeConversionBundle: true,
} as const;

export const createDefaultNegativeLabModalSession = (targetPaths: readonly string[]) =>
  createNegativeLabSessionState(targetPaths, {
    recipeState: {
      conversionScope: 'all',
      openSavedPositiveInEditor: true,
      params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
      patchSamplerCorrectionPayload: EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD,
      saveOptions: DEFAULT_SAVE_OPTIONS,
      selectedAcquisitionProfileId: 'camera_raw_linear_v1',
      selectedPresetId: DEFAULT_NEGATIVE_LAB_UI_PRESET.presetId,
    },
    sessionId: `negative_lab_modal_session_${buildNegativeLabPlanHash(targetPaths.join('|'))}`,
  });

/**
 * Owns the user-command transition into Negative Lab. Persisted recipe/proof state is
 * reconciled here, before the keyed UI session renders; ordinary transient UI state
 * belongs to that keyed child and is never copied into this store object.
 */
export const openNegativeLabModalSession = (
  currentState: NegativeConversionModalState,
  targetPaths: readonly string[],
): NegativeConversionModalState => {
  const orderedTargetPaths = [...targetPaths];
  const session = reconcileNegativeLabSessionTargetPaths(
    currentState.session ?? createDefaultNegativeLabModalSession(orderedTargetPaths),
    orderedTargetPaths,
  );

  return {
    isOpen: true,
    operationEpoch: currentState.operationEpoch + 1,
    session,
    targetPaths: orderedTargetPaths,
  };
};
