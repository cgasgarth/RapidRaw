import { describe, expect, test } from 'bun:test';
import {
  buildEditorToolbarCommands,
  type EditorToolbarCommandActions,
  type EditorToolbarCommandLabels,
  type EditorToolbarCommandState,
  partitionEditorToolbarCommands,
} from '../../../src/components/panel/editor/editorToolbarCommands';

const labels: EditorToolbarCommandLabels = {
  backToLibrary: 'Back to Library',
  compareOrientation: 'Use horizontal compare',
  compareSideBySide: 'Compare side by side',
  compareSplitWipe: 'Compare split wipe',
  fullscreen: 'Toggle preview mode',
  lightsOut: 'Lights out: Off',
  negativeLab: 'Convert Negative',
  redo: 'Redo',
  redoShortcut: 'Cmd+Y',
  showOriginal: 'Hold original',
  softProof: 'Soft proof',
  undo: 'Undo',
  undoShortcut: 'Cmd+Z',
};

const state: EditorToolbarCommandState = {
  canRedo: false,
  canSoftProof: true,
  canUndo: true,
  compareMode: 'split-wipe',
  compareOrientation: 'vertical',
  isFullScreen: true,
  isSoftProofEnabled: true,
  lightsOutLevel: 'dim',
  negativeLabDisabledReason: 'Unsupported source',
  showOriginal: false,
};

function createActions(calls: string[]): EditorToolbarCommandActions {
  return {
    backToLibrary: () => calls.push('back-to-library'),
    changeCompareOrientation: () => calls.push('compare-orientation'),
    openNegativeLab: () => calls.push('negative-lab'),
    redo: () => calls.push('redo'),
    toggleCompareSideBySide: () => calls.push('compare-side-by-side'),
    toggleCompareSplitWipe: () => calls.push('compare-split-wipe'),
    toggleFullScreen: () => calls.push('fullscreen'),
    toggleLightsOut: () => calls.push('lights-out'),
    toggleShowOriginal: () => calls.push('show-original'),
    toggleSoftProof: () => calls.push('soft-proof'),
    undo: () => calls.push('undo'),
  };
}

describe('editor toolbar command model', () => {
  test('publishes enabled, pressed, shortcut, and disabled-reason state', () => {
    const commands = buildEditorToolbarCommands(state, labels, createActions([]));

    expect(commands.map((command) => command.priority)).toEqual([0, 10, 20, 30, 40, 50, 100, 110, 120, 200, 210]);
    expect(commands.find((command) => command.id === 'undo')).toMatchObject({
      enabled: true,
      shortcutHint: 'Cmd+Z',
      tooltip: 'Undo',
    });
    expect(commands.find((command) => command.id === 'redo')?.enabled).toBeFalse();
    expect(commands.find((command) => command.id === 'fullscreen')?.pressed).toBeTrue();
    expect(commands.find((command) => command.id === 'compare-split-wipe')?.pressed).toBeTrue();
    expect(commands.find((command) => command.id === 'soft-proof')?.pressed).toBeTrue();
    expect(commands.find((command) => command.id === 'negative-lab')).toMatchObject({
      disabledReason: 'Unsupported source',
      enabled: false,
      tooltip: 'Unsupported source',
    });
  });

  test('moves lower-priority presentation commands into compact overflow deterministically', () => {
    const commands = buildEditorToolbarCommands(state, labels, createActions([]));
    const standard = partitionEditorToolbarCommands(commands, false);
    const compact = partitionEditorToolbarCommands(commands, true);

    expect(standard.primary.map((command) => command.id)).toEqual([
      'undo',
      'redo',
      'show-original',
      'lights-out',
      'fullscreen',
    ]);
    expect(compact.primary.map((command) => command.id)).toEqual(['undo', 'redo', 'fullscreen']);
    expect(compact.overflow.map((command) => command.id)).toEqual([
      'show-original',
      'lights-out',
      'compare-split-wipe',
      'compare-side-by-side',
      'compare-orientation',
      'negative-lab',
      'soft-proof',
    ]);
  });

  test('routes every presentation through its existing action', () => {
    const calls: string[] = [];
    const commands = buildEditorToolbarCommands(state, labels, createActions(calls));

    for (const command of commands) command.action();

    expect(calls).toEqual(commands.map((command) => command.id));
  });
});
