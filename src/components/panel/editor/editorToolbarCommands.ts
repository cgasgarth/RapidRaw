export type EditorToolbarCommandId =
  | 'back-to-library'
  | 'undo'
  | 'redo'
  | 'show-original'
  | 'compare-split-wipe'
  | 'compare-side-by-side'
  | 'compare-orientation'
  | 'negative-lab'
  | 'soft-proof'
  | 'lights-out'
  | 'fullscreen';

export type EditorToolbarCommandPlacement = 'navigation' | 'primary' | 'overflow';

export interface EditorToolbarCommand {
  action: () => void;
  disabledReason?: string;
  enabled: boolean;
  id: EditorToolbarCommandId;
  label: string;
  placement: EditorToolbarCommandPlacement;
  pressed?: boolean;
  priority: number;
  shortcutHint?: string;
  tooltip: string;
}

export interface EditorToolbarCommandState {
  canRedo: boolean;
  canSoftProof: boolean;
  canUndo: boolean;
  compareMode: 'off' | 'hold-original' | 'split-wipe' | 'side-by-side';
  compareOrientation: 'vertical' | 'horizontal';
  isFullScreen: boolean;
  isSoftProofEnabled: boolean;
  lightsOutLevel: 'off' | 'dim' | 'black';
  negativeLabDisabledReason: string | null;
  showOriginal: boolean;
}

export interface EditorToolbarCommandLabels {
  backToLibrary: string;
  compareOrientation: string;
  compareSideBySide: string;
  compareSplitWipe: string;
  fullscreen: string;
  lightsOut: string;
  negativeLab: string;
  redo: string;
  redoShortcut: string;
  showOriginal: string;
  softProof: string;
  undo: string;
  undoShortcut: string;
}

export interface EditorToolbarCommandActions {
  backToLibrary: () => void;
  changeCompareOrientation: () => void;
  openNegativeLab: () => void;
  redo: () => void;
  toggleCompareSideBySide: () => void;
  toggleCompareSplitWipe: () => void;
  toggleFullScreen: () => void;
  toggleLightsOut: () => void;
  toggleShowOriginal: () => void;
  toggleSoftProof: () => void;
  undo: () => void;
}

export interface EditorToolbarCommandGroups {
  navigation: EditorToolbarCommand[];
  overflow: EditorToolbarCommand[];
  primary: EditorToolbarCommand[];
}

const compactOverflowIds = new Set<EditorToolbarCommandId>(['show-original', 'lights-out']);

export function partitionEditorToolbarCommands(
  commands: EditorToolbarCommand[],
  compact: boolean,
): EditorToolbarCommandGroups {
  return {
    navigation: commands.filter((command) => command.placement === 'navigation'),
    overflow: commands.filter(
      (command) => command.placement === 'overflow' || (compact && compactOverflowIds.has(command.id)),
    ),
    primary: commands.filter(
      (command) => command.placement === 'primary' && (!compact || !compactOverflowIds.has(command.id)),
    ),
  };
}

export function buildEditorToolbarCommands(
  state: EditorToolbarCommandState,
  labels: EditorToolbarCommandLabels,
  actions: EditorToolbarCommandActions,
): EditorToolbarCommand[] {
  return [
    command('back-to-library', labels.backToLibrary, 'navigation', 0, actions.backToLibrary),
    command('undo', labels.undo, 'primary', 10, actions.undo, {
      enabled: state.canUndo,
      shortcutHint: labels.undoShortcut,
    }),
    command('redo', labels.redo, 'primary', 20, actions.redo, {
      enabled: state.canRedo,
      shortcutHint: labels.redoShortcut,
    }),
    command('show-original', labels.showOriginal, 'primary', 30, actions.toggleShowOriginal, {
      pressed: state.showOriginal,
      shortcutHint: 'B',
    }),
    command('lights-out', labels.lightsOut, 'primary', 40, actions.toggleLightsOut, {
      pressed: state.lightsOutLevel !== 'off',
      shortcutHint: 'L',
    }),
    command('fullscreen', labels.fullscreen, 'primary', 50, actions.toggleFullScreen, {
      pressed: state.isFullScreen,
      shortcutHint: 'F',
    }),
    command('compare-split-wipe', labels.compareSplitWipe, 'overflow', 100, actions.toggleCompareSplitWipe, {
      pressed: state.compareMode === 'split-wipe',
    }),
    command('compare-side-by-side', labels.compareSideBySide, 'overflow', 110, actions.toggleCompareSideBySide, {
      pressed: state.compareMode === 'side-by-side',
    }),
    command('compare-orientation', labels.compareOrientation, 'overflow', 120, actions.changeCompareOrientation, {
      enabled: state.compareMode === 'split-wipe' || state.compareMode === 'side-by-side',
    }),
    command('negative-lab', labels.negativeLab, 'overflow', 200, actions.openNegativeLab, {
      ...(state.negativeLabDisabledReason === null ? {} : { disabledReason: state.negativeLabDisabledReason }),
      enabled: state.negativeLabDisabledReason === null,
    }),
    command('soft-proof', labels.softProof, 'overflow', 210, actions.toggleSoftProof, {
      enabled: state.canSoftProof,
      pressed: state.isSoftProofEnabled,
    }),
  ].sort((left, right) => left.priority - right.priority);
}

function command(
  id: EditorToolbarCommandId,
  label: string,
  placement: EditorToolbarCommandPlacement,
  priority: number,
  action: () => void,
  state: Partial<Pick<EditorToolbarCommand, 'disabledReason' | 'enabled' | 'pressed' | 'shortcutHint'>> = {},
): EditorToolbarCommand {
  return {
    action,
    ...(state.disabledReason === undefined ? {} : { disabledReason: state.disabledReason }),
    enabled: state.enabled ?? true,
    id,
    label,
    placement,
    ...(state.pressed === undefined ? {} : { pressed: state.pressed }),
    priority,
    ...(state.shortcutHint === undefined ? {} : { shortcutHint: state.shortcutHint }),
    tooltip: state.disabledReason ?? label,
  };
}
