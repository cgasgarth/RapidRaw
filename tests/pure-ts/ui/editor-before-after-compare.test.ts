import { beforeEach, describe, expect, test } from 'bun:test';
import type { SelectedImage } from '../../../src/components/ui/AppProperties';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { resolveEditorOverlayVisibility } from '../../../src/utils/editorOverlayVisibility';

const image = (path: string): SelectedImage => ({
  height: 4000,
  isRaw: true,
  isReady: true,
  originalUrl: `blob:${path}-original`,
  path,
  thumbnailUrl: `blob:${path}-thumb`,
  width: 6000,
});

const resetEditorCompareState = () => {
  useEditorStore.setState({
    adjustments: INITIAL_ADJUSTMENTS,
    compareMode: 'off',
    finalPreviewUrl: null,
    history: [INITIAL_ADJUSTMENTS],
    historyCheckpoints: [],
    historyIndex: 0,
    selectedImage: null,
    showOriginal: false,
    transformedOriginalUrl: null,
    uncroppedAdjustedPreviewUrl: null,
  });
};

const compareVisibility = (
  compareMode: 'off' | 'hold-original' | 'split-wipe' | 'side-by-side',
  showOriginal: boolean,
) =>
  resolveEditorOverlayVisibility({
    blocker: 'none',
    canShowOriginalCompare: true,
    compareMode,
    hasDisplayedMask: true,
    isCurrentGamutWarningOverlay: false,
    isExportSoftProofEnabled: false,
    isGamutWarningOverlayVisible: false,
    isMaskControlHovered: false,
    isMaskInteractionActive: false,
    isSliderDragging: false,
    showOriginal,
  });

describe('editor before-after compare state', () => {
  beforeEach(() => {
    resetEditorCompareState();
  });

  test('supports transient hold-to-before over sticky split compare', () => {
    const { setEditor } = useEditorStore.getState();

    setEditor({ compareMode: 'split-wipe' });
    expect(useEditorStore.getState()).toMatchObject({ compareMode: 'split-wipe', showOriginal: false });

    setEditor({ showOriginal: true });
    expect(useEditorStore.getState()).toMatchObject({ compareMode: 'split-wipe', showOriginal: true });
    expect(compareVisibility('split-wipe', true)).toMatchObject({
      showOriginalCompare: true,
      showSplitCompare: false,
    });

    setEditor({ showOriginal: false });
    expect(useEditorStore.getState()).toMatchObject({ compareMode: 'split-wipe', showOriginal: false });
    expect(compareVisibility('split-wipe', false)).toMatchObject({
      showOriginalCompare: false,
      showSplitCompare: true,
    });
  });

  test('uses hold-original only when before is held without a sticky compare mode', () => {
    const { setEditor } = useEditorStore.getState();

    setEditor({ showOriginal: true });
    expect(useEditorStore.getState()).toMatchObject({ compareMode: 'hold-original', showOriginal: true });

    setEditor({ showOriginal: false });
    expect(useEditorStore.getState()).toMatchObject({ compareMode: 'off', showOriginal: false });
  });

  test('resets compare state and transformed baseline when the selected image changes', () => {
    const { setEditor } = useEditorStore.getState();

    setEditor({
      selectedImage: image('/photos/a.ARW'),
      compareMode: 'side-by-side',
      transformedOriginalUrl: 'blob:stale-before-preview',
    });
    expect(useEditorStore.getState()).toMatchObject({
      compareMode: 'off',
      showOriginal: false,
      transformedOriginalUrl: null,
    });

    setEditor({
      compareMode: 'split-wipe',
      transformedOriginalUrl: 'blob:a-before-preview',
    });
    setEditor({ selectedImage: image('/photos/b.ARW') });

    expect(useEditorStore.getState()).toMatchObject({
      compareMode: 'off',
      showOriginal: false,
      transformedOriginalUrl: null,
    });
  });
});
