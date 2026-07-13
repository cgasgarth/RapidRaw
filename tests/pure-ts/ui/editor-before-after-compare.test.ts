import { beforeEach, describe, expect, test } from 'bun:test';
import type { SelectedImage } from '../../../src/components/ui/AppProperties';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { DEFAULT_EDITOR_COMPARE_STATE } from '../../../src/utils/editorCompare';
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

describe('editor before-after compare state', () => {
  beforeEach(() => {
    useEditorStore.setState({
      adjustments: INITIAL_ADJUSTMENTS,
      compare: DEFAULT_EDITOR_COMPARE_STATE,
      selectedImage: null,
      transformedOriginalUrl: null,
    });
  });

  test('supports transient hold-to-original over a sticky wipe without replacing its mode', () => {
    const { dispatchCompare } = useEditorStore.getState();
    dispatchCompare({ mode: 'split-wipe', type: 'set-mode' });
    dispatchCompare({ held: true, type: 'set-original-held' });

    expect(useEditorStore.getState().compare).toMatchObject({ isOriginalHeld: true, mode: 'split-wipe' });
    expect(
      resolveEditorOverlayVisibility({
        blocker: 'none',
        canShowOriginalCompare: true,
        compareMode: 'split-wipe',
        hasDisplayedMask: true,
        isCurrentGamutWarningOverlay: false,
        isExportSoftProofEnabled: false,
        isGamutWarningOverlayVisible: false,
        isMaskControlHovered: false,
        isMaskInteractionActive: false,
        isSliderDragging: false,
        showOriginal: true,
      }),
    ).toMatchObject({ showOriginalCompare: true, showSplitCompare: false });

    dispatchCompare({ held: false, type: 'set-original-held' });
    expect(useEditorStore.getState().compare).toMatchObject({ isOriginalHeld: false, mode: 'split-wipe' });
  });

  test('keeps latched original and press-and-hold as distinct commands', () => {
    const { dispatchCompare } = useEditorStore.getState();
    dispatchCompare({ type: 'toggle-original' });
    expect(useEditorStore.getState().compare).toMatchObject({ isOriginalHeld: false, mode: 'hold-original' });
    dispatchCompare({ held: true, type: 'set-original-held' });
    dispatchCompare({ held: false, type: 'set-original-held' });
    expect(useEditorStore.getState().compare.mode).toBe('hold-original');
    dispatchCompare({ type: 'toggle-original' });
    expect(useEditorStore.getState().compare.mode).toBe('off');
  });

  test('resets source-bound compare state when selection changes', () => {
    const { dispatchCompare, setEditor } = useEditorStore.getState();
    setEditor({ selectedImage: image('/photos/a.ARW') });
    dispatchCompare({ mode: 'side-by-side', type: 'set-mode' });
    setEditor({ transformedOriginalUrl: 'blob:a-before-preview' });
    setEditor({ selectedImage: image('/photos/b.ARW') });

    expect(useEditorStore.getState()).toMatchObject({
      compare: {
        isOriginalHeld: false,
        mode: 'off',
        source: { identity: '/photos/b.ARW', kind: 'original' },
      },
      transformedOriginalUrl: null,
    });
  });

  test('keeps a pinned reference source across target navigation', () => {
    const { dispatchCompare, setEditor } = useEditorStore.getState();
    setEditor({ selectedImage: image('/photos/reference.ARW') });
    dispatchCompare({
      identity: '/photos/reference.ARW:render-7',
      label: 'reference.ARW',
      type: 'set-reference-source',
    });
    dispatchCompare({ mode: 'side-by-side', type: 'set-mode' });

    setEditor({ selectedImage: image('/photos/target.ARW') });

    expect(useEditorStore.getState().compare).toMatchObject({
      mode: 'side-by-side',
      source: {
        identity: '/photos/reference.ARW:render-7',
        kind: 'reference',
        label: 'reference.ARW',
      },
    });
  });
});
