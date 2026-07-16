import type { ImageDimensions, RenderSize } from '../hooks/viewport/useImageRenderSize';

export type EditorCompareMode = 'off' | 'hold-original' | 'split-wipe' | 'side-by-side';
export type EditorCompareOrientation = 'horizontal' | 'vertical';

/** The sticky modes cycled by the viewer's Before/After command. Hold-original is
 * intentionally excluded: it is a transient/loupe mode and is controlled by B. */
export const EDITOR_COMPARE_MODE_CYCLE = ['off', 'side-by-side', 'split-wipe'] as const;
export type EditorCompareCycleMode = (typeof EDITOR_COMPARE_MODE_CYCLE)[number];
export type EditorCompareSource =
  | { identity: string | null; kind: 'original' }
  | { identity: string; kind: 'reference'; label: string };

export interface EditorCompareState {
  dividerPosition: number;
  isOriginalHeld: boolean;
  labelsVisible: boolean;
  mode: EditorCompareMode;
  orientation: EditorCompareOrientation;
  source: EditorCompareSource;
  synchronizedTransform: 'locked';
}

export interface EditorComparePresentation {
  readonly active: boolean;
  readonly axis: EditorCompareOrientation;
  readonly isHoldOriginal: boolean;
  readonly isSideBySide: boolean;
  readonly isSplitWipe: boolean;
  readonly paneOrder: readonly ['original', 'edited'];
}

export type EditorCompareCommand =
  | { mode: EditorCompareMode; type: 'set-mode' }
  | { orientation: EditorCompareOrientation; type: 'set-orientation' }
  | { position: number; type: 'set-divider' }
  | { held: boolean; type: 'set-original-held' }
  | { type: 'toggle-original' }
  | { type: 'reset-divider' }
  | { identity: string | null; type: 'set-original-source' }
  | { identity: string; label: string; type: 'set-reference-source' }
  | { type: 'exit' };

export const DEFAULT_EDITOR_COMPARE_STATE: EditorCompareState = {
  dividerPosition: 0.5,
  isOriginalHeld: false,
  labelsVisible: true,
  mode: 'off',
  orientation: 'vertical',
  source: { identity: null, kind: 'original' },
  synchronizedTransform: 'locked',
};

export const clampCompareDivider = (position: number): number => {
  if (!Number.isFinite(position)) return 0.5;
  return Math.min(0.95, Math.max(0.05, position));
};

export const isEditorCompareActive = (state: Pick<EditorCompareState, 'isOriginalHeld' | 'mode'>): boolean =>
  state.mode !== 'off' || state.isOriginalHeld;

export const resolveEditorComparePresentation = (
  state: Pick<EditorCompareState, 'isOriginalHeld' | 'mode' | 'orientation'>,
): EditorComparePresentation => ({
  active: isEditorCompareActive(state),
  axis: state.orientation,
  isHoldOriginal: state.mode === 'hold-original' || state.isOriginalHeld,
  isSideBySide: state.mode === 'side-by-side' && !state.isOriginalHeld,
  isSplitWipe: state.mode === 'split-wipe' && !state.isOriginalHeld,
  paneOrder: ['original', 'edited'],
});

export const cycleEditorCompareMode = (mode: EditorCompareMode, direction: 1 | -1 = 1): EditorCompareCycleMode => {
  const current: EditorCompareCycleMode = EDITOR_COMPARE_MODE_CYCLE.includes(mode as EditorCompareCycleMode)
    ? (mode as EditorCompareCycleMode)
    : 'off';
  const index = EDITOR_COMPARE_MODE_CYCLE.indexOf(current);
  return (
    EDITOR_COMPARE_MODE_CYCLE[
      (index + direction + EDITOR_COMPARE_MODE_CYCLE.length) % EDITOR_COMPARE_MODE_CYCLE.length
    ] ?? 'off'
  );
};

export const reduceEditorCompare = (state: EditorCompareState, command: EditorCompareCommand): EditorCompareState => {
  switch (command.type) {
    case 'set-mode':
      return { ...state, isOriginalHeld: false, mode: command.mode };
    case 'set-orientation':
      return { ...state, orientation: command.orientation };
    case 'set-divider':
      return { ...state, dividerPosition: clampCompareDivider(command.position) };
    case 'set-original-held':
      return { ...state, isOriginalHeld: command.held };
    case 'toggle-original':
      return { ...state, isOriginalHeld: false, mode: state.mode === 'hold-original' ? 'off' : 'hold-original' };
    case 'reset-divider':
      return { ...state, dividerPosition: 0.5 };
    case 'set-original-source':
      return { ...state, source: { identity: command.identity, kind: 'original' } };
    case 'set-reference-source':
      return { ...state, source: { identity: command.identity, kind: 'reference', label: command.label } };
    case 'exit':
      return { ...state, isOriginalHeld: false, mode: 'off' };
  }
};

export interface ComparePaneLayout {
  edited: RenderSize;
  original: RenderSize;
}

export const resolveComparePaneLayout = ({
  imageDimensions,
  mode,
  orientation,
  viewport,
}: {
  imageDimensions: ImageDimensions;
  mode: EditorCompareMode;
  orientation: EditorCompareOrientation;
  viewport: ImageDimensions;
}): ComparePaneLayout => {
  const isPaired = mode === 'side-by-side';
  // Hold-original and split-wipe are rendered in one shared image rect. The
  // orientation still remains part of the state so switching back to a paired
  // view preserves the user's last axis.
  const gap = isPaired ? 8 : 0;
  const pane = {
    height: isPaired && orientation === 'horizontal' ? (viewport.height - gap) / 2 : viewport.height,
    width: isPaired && orientation === 'vertical' ? (viewport.width - gap) / 2 : viewport.width,
  };
  const scale = Math.min(pane.width / imageDimensions.width, pane.height / imageDimensions.height);
  const width = imageDimensions.width * scale;
  const height = imageDimensions.height * scale;
  const firstPaneX = (pane.width - width) / 2;
  const firstPaneY = (pane.height - height) / 2;
  const secondPaneX = orientation === 'vertical' && isPaired ? pane.width + gap : 0;
  const secondPaneY = orientation === 'horizontal' && isPaired ? pane.height + gap : 0;
  const render = (x: number, y: number): RenderSize => ({ height, offsetX: x, offsetY: y, scale, width });
  return {
    original: render(firstPaneX, firstPaneY),
    edited: render(secondPaneX + firstPaneX, secondPaneY + firstPaneY),
  };
};

export const resolveCompareDividerGeometry = ({
  dividerPosition,
  imageRect,
  orientation,
}: {
  dividerPosition: number;
  imageRect: RenderSize;
  orientation: EditorCompareOrientation;
}) => {
  const position = clampCompareDivider(dividerPosition);
  return orientation === 'vertical'
    ? {
        clipPath: `inset(0 ${String((1 - position) * 100)}% 0 0)`,
        left: imageRect.offsetX + imageRect.width * position,
        top: imageRect.offsetY,
        width: 1,
        height: imageRect.height,
      }
    : {
        clipPath: `inset(0 0 ${String((1 - position) * 100)}% 0)`,
        left: imageRect.offsetX,
        top: imageRect.offsetY + imageRect.height * position,
        width: imageRect.width,
        height: 1,
      };
};
