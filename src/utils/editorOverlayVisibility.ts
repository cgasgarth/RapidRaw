import type { EditorCompareMode } from '../store/useEditorStore';

export type EditorOverlayBlocker = 'ai' | 'crop' | 'mask' | 'none' | 'remove' | 'retouch' | 'white-balance';

export interface ResolveEditorOverlayBlockerInput {
  hasActiveRemoveSource: boolean;
  hasActiveRetouchSource: boolean;
  isAiEditing: boolean;
  isCropping: boolean;
  isMasking: boolean;
  isWbPickerActive: boolean;
}

export interface ResolveEditorOverlayVisibilityInput {
  blocker: EditorOverlayBlocker;
  canShowOriginalCompare: boolean;
  compareMode: EditorCompareMode;
  hasDisplayedMask: boolean;
  isCurrentGamutWarningOverlay: boolean;
  isExportSoftProofEnabled: boolean;
  isGamutWarningOverlayVisible: boolean;
  isMaskControlHovered: boolean;
  isMaskInteractionActive: boolean;
  isSliderDragging: boolean;
  showOriginal: boolean;
}

export interface EditorOverlayVisibility {
  compareOverlayDisabled: boolean;
  compareOverlayDisabledReason: EditorOverlayBlocker;
  isCompareModeActive: boolean;
  isHoldOriginalCompare: boolean;
  isShowingOriginal: boolean;
  isSideBySideCompare: boolean;
  isSplitCompare: boolean;
  showGamutWarningOverlay: boolean;
  showMaskOverlay: boolean;
  showOriginalCompare: boolean;
  showRetouchRemoveHandles: boolean;
  showSideBySideCompare: boolean;
  showSplitCompare: boolean;
}

export const resolveEditorOverlayBlocker = ({
  hasActiveRemoveSource,
  hasActiveRetouchSource,
  isAiEditing,
  isCropping,
  isMasking,
  isWbPickerActive,
}: ResolveEditorOverlayBlockerInput): EditorOverlayBlocker => {
  if (isCropping) return 'crop';
  if (isWbPickerActive) return 'white-balance';
  if (hasActiveRetouchSource) return 'retouch';
  if (hasActiveRemoveSource) return 'remove';
  if (isAiEditing) return 'ai';
  if (isMasking) return 'mask';
  return 'none';
};

export const resolveEditorOverlayVisibility = ({
  blocker,
  canShowOriginalCompare,
  compareMode,
  hasDisplayedMask,
  isCurrentGamutWarningOverlay,
  isExportSoftProofEnabled,
  isGamutWarningOverlayVisible,
  isMaskControlHovered,
  isMaskInteractionActive,
  isSliderDragging,
  showOriginal,
}: ResolveEditorOverlayVisibilityInput): EditorOverlayVisibility => {
  const isHoldOriginalCompare = compareMode === 'hold-original' || showOriginal;
  const isSplitCompare = compareMode === 'split-wipe';
  const isSideBySideCompare = compareMode === 'side-by-side';
  const isCompareModeActive = compareMode !== 'off';
  const compareOverlayDisabled = isCompareModeActive && blocker !== 'none';
  const showOriginalCompare = isHoldOriginalCompare && canShowOriginalCompare && !compareOverlayDisabled;
  const showSplitCompare = isSplitCompare && !compareOverlayDisabled;
  const showSideBySideCompare = isSideBySideCompare && !compareOverlayDisabled;
  const isShowingOriginal = showOriginalCompare;
  const showGamutWarningOverlay =
    isGamutWarningOverlayVisible &&
    isExportSoftProofEnabled &&
    isCurrentGamutWarningOverlay &&
    blocker === 'none' &&
    !isShowingOriginal &&
    !showSideBySideCompare;
  const showMaskOverlay =
    hasDisplayedMask &&
    blocker !== 'crop' &&
    !isCompareModeActive &&
    !showGamutWarningOverlay &&
    !isMaskControlHovered &&
    !isSliderDragging &&
    !isMaskInteractionActive;

  return {
    compareOverlayDisabled,
    compareOverlayDisabledReason: compareOverlayDisabled ? blocker : 'none',
    isCompareModeActive,
    isHoldOriginalCompare,
    isShowingOriginal,
    isSideBySideCompare,
    isSplitCompare,
    showGamutWarningOverlay,
    showMaskOverlay,
    showOriginalCompare,
    showRetouchRemoveHandles: blocker !== 'crop' && !isCompareModeActive && !showGamutWarningOverlay,
    showSideBySideCompare,
    showSplitCompare,
  };
};
