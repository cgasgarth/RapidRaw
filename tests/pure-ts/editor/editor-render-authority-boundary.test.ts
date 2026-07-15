import { afterEach, describe, expect, test } from 'bun:test';

import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2, setEditDocumentV2NodeEnabled } from '../../../src/utils/editDocumentV2';

const reset = () => {
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    adjustments,
    editDocumentV2: legacyAdjustmentsToEditDocumentV2(adjustments),
    editDocumentHistory: [legacyAdjustmentsToEditDocumentV2(adjustments)],
    history: [adjustments],
    historyCheckpoints: [],
    historyIndex: 0,
  });
};

afterEach(reset);

describe('editor render-authority boundary', () => {
  test('generic editor and Zustand setters fail closed for structural authority updates', () => {
    const state = useEditorStore.getState();
    const adjustmentUpdate = { adjustments: { ...state.adjustments, exposure: 0.75 } };
    const historyUpdate = { history: [state.adjustments] };
    const typedHistoryUpdate = { editDocumentHistory: [state.editDocumentV2] };
    const adjustmentUpdater = () => adjustmentUpdate;
    const historyUpdater = () => historyUpdate;

    expect(() => Reflect.apply(state.setEditor, undefined, [adjustmentUpdate])).toThrow(
      'editor.setEditor.render_authority_forbidden:adjustments',
    );
    expect(() => Reflect.apply(useEditorStore.setState, useEditorStore, [historyUpdate])).toThrow(
      'editor.setState.render_authority_forbidden:history',
    );
    expect(() => Reflect.apply(state.setEditor, undefined, [typedHistoryUpdate])).toThrow(
      'editor.setEditor.render_authority_forbidden:editDocumentHistory',
    );
    expect(() => Reflect.apply(state.setEditor, undefined, [adjustmentUpdater])).toThrow(
      'editor.setEditor.render_authority_forbidden:adjustments',
    );
    expect(() => Reflect.apply(useEditorStore.setState, useEditorStore, [historyUpdater])).toThrow(
      'editor.setState.render_authority_forbidden:history',
    );
    expect(() => Reflect.apply(useEditorStore.setState, useEditorStore, [state, true])).toThrow(
      'editor.setState.replace_forbidden',
    );
    expect(useEditorStore.getState().adjustments.exposure).toBe(INITIAL_ADJUSTMENTS.exposure);
    expect(useEditorStore.getState().history).toHaveLength(1);
  });

  test('typed hydration preserves disabled-node authority in the published snapshot', () => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.4 };
    const editDocumentV2 = setEditDocumentV2NodeEnabled(
      legacyAdjustmentsToEditDocumentV2(adjustments),
      'tone_equalizer',
      false,
    );

    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 7,
      adjustments,
      editDocumentV2,
      editDocumentHistory: [editDocumentV2],
      history: [adjustments],
      historyIndex: 0,
    });
    const hydrated = useEditorStore.getState();

    expect(hydrated.adjustmentRevision).toBe(7);
    expect(hydrated.editDocumentV2.nodes.tone_equalizer?.enabled).toBe(false);
    expect(hydrated.editDocumentHistory[0]?.nodes.tone_equalizer?.enabled).toBe(false);
    expect(hydrated.adjustmentSnapshot.editDocumentV2).toBe(hydrated.editDocumentV2);
    expect(hydrated.adjustmentSnapshot.value.exposure).toBe(0.4);

    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 8,
      adjustments,
      editDocumentV2,
      history: [adjustments],
      historyIndex: 0,
    });
    expect(useEditorStore.getState().editDocumentHistory[0]?.nodes.tone_equalizer?.enabled).toBe(false);
  });

  test('generic non-render UI updates remain available', () => {
    useEditorStore.getState().setEditor({ isWaveformVisible: true });
    useEditorStore.setState({ activeMaskId: 'mask-ui-selection' });

    expect(useEditorStore.getState()).toMatchObject({
      activeMaskId: 'mask-ui-selection',
      isWaveformVisible: true,
    });
  });
});
