import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { sceneGlobalColorToneParamsV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { createDefaultEditDocumentV2, setEditDocumentV2NodeEnabled } from '../../../src/utils/editDocumentV2';

const reset = () => {
  const editDocumentV2 = createDefaultEditDocumentV2();
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    historyCheckpoints: [],
    historyIndex: 0,
    history: [editDocumentV2],
    imageSession: null,
    selectedImage: null,
  });
};

beforeEach(reset);
afterEach(reset);

describe('editor render-authority boundary', () => {
  test('exposes one document, revision, and document-history authority', () => {
    const state = useEditorStore.getState();

    expect(Object.hasOwn(state, 'adjustments')).toBeFalse();
    expect(Object.hasOwn(state, 'editDocumentHistory')).toBeFalse();
    expect(state.adjustmentSnapshot.editDocumentV2).toBe(state.editDocumentV2);
    expect(state.history).toEqual([state.editDocumentV2]);

    const storeSource = readFileSync(new URL('../../../src/store/useEditorStore.ts', import.meta.url), 'utf8');
    const editorStateSource = storeSource.slice(
      storeSource.indexOf('interface EditorState {'),
      storeSource.indexOf('const editorRenderAuthorityKeys'),
    );
    expect(storeSource).not.toContain(['legacy', 'AdjustmentsToEditDocumentV2'].join(''));
    expect(editorStateSource).not.toMatch(/^\s*adjustments:\s*Adjustments/m);
    expect(editorStateSource).not.toMatch(/^\s*editDocumentHistory:/m);
  });

  test('rejects flat and structural authority injection through every generic setter', () => {
    const state = useEditorStore.getState();
    const removedAdjustmentUpdate = { adjustments: { exposure: 0.75 } };
    const removedHistoryUpdate = { editDocumentHistory: [state.editDocumentV2] };
    const historyUpdate = { history: [state.editDocumentV2] };

    expect(() => Reflect.apply(state.setEditor, undefined, [removedAdjustmentUpdate])).toThrow(
      'editor.setEditor.render_authority_forbidden:adjustments',
    );
    expect(() => Reflect.apply(state.hydrateEditorRenderAuthority, undefined, [removedAdjustmentUpdate])).toThrow(
      'editor.setEditor.render_authority_forbidden:adjustments',
    );
    expect(() => Reflect.apply(state.hydrateEditorRenderAuthority, undefined, [removedHistoryUpdate])).toThrow(
      'editor.setEditor.render_authority_forbidden:editDocumentHistory',
    );
    expect(() => Reflect.apply(useEditorStore.setState, useEditorStore, [historyUpdate])).toThrow(
      'editor.setState.render_authority_forbidden:history',
    );
    expect(() => Reflect.apply(useEditorStore.setState, useEditorStore, [state, true])).toThrow(
      'editor.setState.replace_forbidden',
    );
  });

  test('requires hydration history to contain the exact current document', () => {
    const current = createDefaultEditDocumentV2();
    const mismatched = setEditDocumentV2NodeEnabled(current, 'tone_equalizer', false);

    expect(() =>
      useEditorStore.getState().hydrateEditorRenderAuthority({
        adjustmentRevision: 7,
        editDocumentV2: current,
        historyIndex: 0,
        history: [mismatched],
      }),
    ).toThrow('editor.hydration.inconsistent_history');
  });

  test('publishes, navigates, and resets the same immutable document stream', () => {
    const initialState = useEditorStore.getState();
    const original = initialState.editDocumentV2;
    const result = initialState.applyEditTransaction({
      baseAdjustmentRevision: 0,
      history: 'single-entry',
      imageSessionId: `editor-image-session:${String(initialState.imageSessionId)}`,
      operations: [
        { type: 'patch-edit-document-node', nodeType: 'scene_global_color_tone', patch: { exposure: 1.25 } },
      ],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'sole-authority-proof',
    });
    const committed = useEditorStore.getState();

    expect(result.afterEditDocumentV2).toBe(committed.editDocumentV2);
    expect(committed.adjustmentRevision).toBe(1);
    expect(committed.history).toEqual([original, committed.editDocumentV2]);
    expect(committed.editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(1.25);
    expect(Object.isFrozen(committed.editDocumentV2)).toBeTrue();
    expect(Reflect.set(committed.editDocumentV2, 'exposure', 99)).toBeFalse();
    expect(committed.editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(1.25);
    expect(
      sceneGlobalColorToneParamsV2Schema.parse(
        useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']?.params,
      ).exposure,
    ).toBe(1.25);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2).toEqual(original);
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0);
    useEditorStore.getState().redo();
    expect(
      sceneGlobalColorToneParamsV2Schema.parse(
        useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']?.params,
      ).exposure,
    ).toBe(1.25);
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
