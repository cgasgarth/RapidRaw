import { describe, expect, test } from 'bun:test';

import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildEditHistoryItems,
  createEditHistoryCheckpoint,
  formatEditHistoryDiffLabel,
  pushEditHistoryEntryWithCheckpoints,
  renameEditHistoryCheckpoint,
} from '../../../src/utils/editHistory';

describe('edit history checkpoints', () => {
  test('builds meaningful labels from adjustment diffs', () => {
    expect(
      formatEditHistoryDiffLabel(INITIAL_ADJUSTMENTS, {
        ...INITIAL_ADJUSTMENTS,
        exposure: 0.35,
      }),
    ).toBe('Exposure');

    expect(
      formatEditHistoryDiffLabel(INITIAL_ADJUSTMENTS, {
        ...INITIAL_ADJUSTMENTS,
        contrast: 18,
        exposure: 0.35,
      }),
    ).toBe('Contrast, Exposure');

    expect(
      formatEditHistoryDiffLabel(INITIAL_ADJUSTMENTS, {
        ...INITIAL_ADJUSTMENTS,
        brightness: 0.2,
        contrast: 18,
        exposure: 0.35,
      }),
    ).toBe('Brightness, Contrast...');
  });

  test('lets session checkpoints override generated labels and be renamed', () => {
    const history = [
      INITIAL_ADJUSTMENTS,
      { ...INITIAL_ADJUSTMENTS, exposure: 0.35 },
      { ...INITIAL_ADJUSTMENTS, contrast: 18, exposure: 0.35 },
    ];
    const checkpoints = createEditHistoryCheckpoint(
      [],
      2,
      'Contrast, Exposure',
      'checkpoint-2',
      '2026-07-01T12:00:00.000Z',
    );
    const renamed = renameEditHistoryCheckpoint(checkpoints, 'checkpoint-2', 'Client proof candidate');

    expect(buildEditHistoryItems(history, renamed).map((item) => item.label)).toEqual([
      'Initial State',
      'Exposure',
      'Client proof candidate',
    ]);
    expect(buildEditHistoryItems(history, renamed)[2]?.isCheckpoint).toBe(true);
  });

  test('drops checkpoint metadata for discarded redo entries', () => {
    const history = [
      INITIAL_ADJUSTMENTS,
      { ...INITIAL_ADJUSTMENTS, exposure: 0.35 },
      { ...INITIAL_ADJUSTMENTS, contrast: 18, exposure: 0.35 },
    ];
    const checkpoints = createEditHistoryCheckpoint(
      [],
      2,
      'Contrast, Exposure',
      'checkpoint-2',
      '2026-07-01T12:00:00.000Z',
    );
    const pushed = pushEditHistoryEntryWithCheckpoints(
      history,
      1,
      { ...INITIAL_ADJUSTMENTS, exposure: 0.35, highlights: -20 },
      checkpoints,
    );

    expect(pushed.historyIndex).toBe(2);
    expect(pushed.history).toHaveLength(3);
    expect(pushed.checkpoints).toEqual([]);
    expect(buildEditHistoryItems(pushed.history, pushed.checkpoints)[2]?.label).toBe('Highlights');
  });

  test('history navigation invalidates stale preview URLs while keeping redo available', () => {
    const initial = structuredClone(INITIAL_ADJUSTMENTS);
    const exposureEdit = { ...initial, exposure: 0.35 };
    const contrastEdit = { ...exposureEdit, contrast: 18 };

    useEditorStore.setState({
      adjustments: contrastEdit,
      finalPreviewUrl: 'blob:stale-history-preview',
      history: [initial, exposureEdit, contrastEdit],
      historyCheckpoints: [],
      historyIndex: 2,
      uncroppedAdjustedPreviewUrl: 'blob:stale-uncropped-preview',
    });

    useEditorStore.getState().goToHistoryIndex(1);

    const state = useEditorStore.getState();
    expect(state.adjustments).toEqual(exposureEdit);
    expect(state.finalPreviewUrl).toBeNull();
    expect(state.historyIndex).toBe(1);
    expect(state.history).toHaveLength(3);
    expect(state.uncroppedAdjustedPreviewUrl).toBeNull();
  });
});
