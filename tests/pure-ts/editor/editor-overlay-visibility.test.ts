import { describe, expect, test } from 'bun:test';

import {
  type EditorOverlayBlocker,
  resolveEditorOverlayBlocker,
  resolveEditorOverlayVisibility,
} from '../../../src/utils/editorOverlayVisibility';

const visibility = (overrides: Partial<Parameters<typeof resolveEditorOverlayVisibility>[0]> = {}) =>
  resolveEditorOverlayVisibility({
    blocker: 'none',
    canShowOriginalCompare: true,
    compareMode: 'off',
    hasDisplayedMask: true,
    isCurrentGamutWarningOverlay: false,
    isExportSoftProofEnabled: false,
    isGamutWarningOverlayVisible: false,
    isMaskControlHovered: false,
    isMaskInteractionActive: false,
    isSliderDragging: false,
    showOriginal: false,
    ...overrides,
  });

const blocker = (overrides: Partial<Parameters<typeof resolveEditorOverlayBlocker>[0]> = {}) =>
  resolveEditorOverlayBlocker({
    hasActiveRemoveSource: false,
    hasActiveRetouchSource: false,
    isAiEditing: false,
    isCropping: false,
    isMasking: false,
    isWbPickerActive: false,
    ...overrides,
  });

describe('editor overlay visibility', () => {
  test.each([
    [{ isCropping: true }, 'crop'],
    [{ isWbPickerActive: true }, 'white-balance'],
    [{ hasActiveRetouchSource: true }, 'retouch'],
    [{ hasActiveRemoveSource: true }, 'remove'],
    [{ isAiEditing: true }, 'ai'],
    [{ isMasking: true }, 'mask'],
  ] satisfies Array<
    [Partial<Parameters<typeof resolveEditorOverlayBlocker>[0]>, EditorOverlayBlocker]
  >)('resolves blocker priority for %p', (input, expected) => {
    expect(blocker(input)).toBe(expected);
  });

  test('disables compare overlays with an explicit reason while editing tools are active', () => {
    const result = visibility({ blocker: 'white-balance', compareMode: 'split-wipe' });

    expect(result.compareOverlayDisabled).toBe(true);
    expect(result.compareOverlayDisabledReason).toBe('white-balance');
    expect(result.showSplitCompare).toBe(false);
    expect(result.showOriginalCompare).toBe(false);
  });

  test('hides mask and retouch overlays in compare mode', () => {
    const result = visibility({ compareMode: 'side-by-side', hasDisplayedMask: true });

    expect(result.showMaskOverlay).toBe(false);
    expect(result.showRetouchRemoveHandles).toBe(false);
    expect(result.showSideBySideCompare).toBe(true);
  });

  test('shows current gamut warning only when soft proof is active and no edit tool blocks it', () => {
    const ready = visibility({
      isCurrentGamutWarningOverlay: true,
      isExportSoftProofEnabled: true,
      isGamutWarningOverlayVisible: true,
    });
    const blocked = visibility({
      blocker: 'mask',
      isCurrentGamutWarningOverlay: true,
      isExportSoftProofEnabled: true,
      isGamutWarningOverlayVisible: true,
    });

    expect(ready.showGamutWarningOverlay).toBe(true);
    expect(ready.showMaskOverlay).toBe(false);
    expect(blocked.showGamutWarningOverlay).toBe(false);
  });
});
