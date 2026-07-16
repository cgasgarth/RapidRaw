import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { editDocumentSourceArtifactsV2Schema } from '../../packages/rawengine-schema/src/editDocumentV2';
import { Mask, type SubMask, SubMaskMode, ToolType } from '../../src/components/panel/right/layers/Masks.tsx';
import { createEditorImageSession, useEditorStore } from '../../src/store/useEditorStore.ts';
import { publishAdjustmentSnapshot } from '../../src/utils/adjustmentSnapshots.ts';
import type { AiPatch } from '../../src/utils/adjustments.ts';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments.ts';
import {
  resolveAiEditSelection,
  selectionAfterPatchDeletion,
  selectionAfterSubMaskDeletion,
} from '../../src/utils/aiEditSelection.ts';
import { buildAiSourceArtifactEditTransaction } from '../../src/utils/aiSourceArtifactEditTransaction.ts';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../src/utils/editDocumentV2.ts';

const sourcePath = '/fixture/ai-source-artifacts.ARW';
const imageSession = createEditorImageSession({ generation: 12, path: sourcePath, source: 'cache' });
const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: sourcePath,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4000,
};

const subMask = (id: string): SubMask => ({
  id,
  invert: false,
  mode: SubMaskMode.Additive,
  opacity: 100,
  type: Mask.Brush,
  visible: true,
});

const patch = (id: string, subMaskIds: Array<string> = []): AiPatch => ({
  id,
  invert: false,
  isLoading: false,
  name: id,
  patchData: null,
  prompt: '',
  subMasks: subMaskIds.map(subMask),
  visible: true,
});

const seedEditor = (adjustments = structuredClone(INITIAL_ADJUSTMENTS)): void => {
  const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'source_artifacts', {
    aiPatches: editDocumentSourceArtifactsV2Schema.parse({ aiPatches: adjustments.aiPatches }).aiPatches,
  });
  useEditorStore.getState().hydrateEditorRenderAuthority({
    activeAiPatchContainerId: null,
    activeAiSubMaskId: null,
    adjustmentRevision: 0,
    brushSettings: { feather: 50, size: 50, tool: ToolType.Brush },
    editDocumentV2,
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession,
    imageSessionId: imageSession.generation,
    lastEditApplicationReceipt: null,
    selectedImage,
    history: [editDocumentV2],
  });
};

const required = <T>(value: T | null): T => {
  if (value === null) throw new Error('Expected value.');
  return value;
};

beforeEach(seedEditor);
afterEach(seedEditor);

describe('AI edit selection resolver', () => {
  test('validates the container and child against one patch snapshot', () => {
    const patches = [patch('first', ['a', 'b']), patch('second', ['c'])];

    expect(resolveAiEditSelection(patches, { containerId: 'first', subMaskId: 'b' })).toEqual({
      containerId: 'first',
      subMaskId: 'b',
    });
    expect(resolveAiEditSelection(patches, { containerId: 'first', subMaskId: 'c' })).toEqual({
      containerId: 'first',
      subMaskId: null,
    });
    expect(resolveAiEditSelection(patches, { containerId: 'missing', subMaskId: 'a' })).toEqual({
      containerId: null,
      subMaskId: null,
    });
    expect(resolveAiEditSelection(patches, { containerId: null, subMaskId: 'a' })).toEqual({
      containerId: null,
      subMaskId: null,
    });
  });

  test('chooses deterministic next-then-previous child fallbacks at every position', () => {
    const patches = [patch('only', ['first', 'middle', 'last'])];
    const selected = (subMaskId: string) => ({ containerId: 'only', subMaskId });

    expect(selectionAfterSubMaskDeletion(patches, selected('first'), 'only', 'first').subMaskId).toBe('middle');
    expect(selectionAfterSubMaskDeletion(patches, selected('middle'), 'only', 'middle').subMaskId).toBe('last');
    expect(selectionAfterSubMaskDeletion(patches, selected('last'), 'only', 'last').subMaskId).toBe('middle');
    expect(selectionAfterSubMaskDeletion([patch('only', ['last'])], selected('last'), 'only', 'last')).toEqual({
      containerId: 'only',
      subMaskId: null,
    });
  });

  test('chooses deterministic adjacent patch fallbacks and preserves unrelated selection', () => {
    const patches = [patch('first'), patch('middle'), patch('last')];

    expect(selectionAfterPatchDeletion(patches, { containerId: 'first', subMaskId: null }, 'first')).toEqual({
      containerId: 'middle',
      subMaskId: null,
    });
    expect(selectionAfterPatchDeletion(patches, { containerId: 'middle', subMaskId: null }, 'middle')).toEqual({
      containerId: 'last',
      subMaskId: null,
    });
    expect(selectionAfterPatchDeletion(patches, { containerId: 'last', subMaskId: null }, 'last')).toEqual({
      containerId: 'middle',
      subMaskId: null,
    });
    expect(selectionAfterPatchDeletion(patches, { containerId: 'last', subMaskId: null }, 'first')).toEqual({
      containerId: 'last',
      subMaskId: null,
    });
  });
});

describe('AI edit store command', () => {
  test('commits patch identity, child selection, brush tool, and history together', () => {
    const initialPatch = patch('first');
    const initial = { ...structuredClone(INITIAL_ADJUSTMENTS), aiPatches: [initialPatch] };
    seedEditor(initial);
    useEditorStore.setState({
      activeAiPatchContainerId: 'first',
      activeAiSubMaskId: null,
      brushSettings: { feather: 25, size: 20, tool: ToolType.Eraser },
    });

    const createdSubMask = subMask('created');
    const committed = useEditorStore.getState().applyAiEditCommand(({ aiPatches }) => ({
      aiPatches: aiPatches.map((candidate) =>
        candidate.id === 'first' ? { ...candidate, subMasks: [createdSubMask] } : candidate,
      ),
      selection: { containerId: 'first', subMaskId: createdSubMask.id },
      selectBrushTool: true,
    }));
    const state = useEditorStore.getState();

    expect(committed).toEqual({ containerId: 'first', subMaskId: 'created' });
    expect(state.editDocumentV2.sourceArtifacts.aiPatches[0]?.subMasks).toMatchObject([createdSubMask]);
    expect(state.activeAiPatchContainerId).toBe('first');
    expect(state.activeAiSubMaskId).toBe('created');
    expect(state.brushSettings?.tool).toBe(ToolType.Brush);
    expect(state.historyIndex).toBe(1);
    expect(state.history[1]).toBe(state.editDocumentV2);
    const sourceArtifactSubMasks = state.editDocumentV2.sourceArtifacts['aiPatches']?.[0]?.subMasks;
    expect(sourceArtifactSubMasks).toHaveLength(1);
    expect(sourceArtifactSubMasks?.[0]).toMatchObject({
      id: createdSubMask.id,
      invert: createdSubMask.invert,
      mode: createdSubMask.mode,
      opacity: createdSubMask.opacity,
      type: createdSubMask.type,
      visible: createdSubMask.visible,
    });
    expect(state.editDocumentV2.nodes['source_artifacts']?.params).toEqual(state.editDocumentV2.sourceArtifacts);
    expect(state.adjustmentSnapshot.editDocumentV2).toBe(state.editDocumentV2);
    expect(state.adjustmentRevision).toBe(1);
    expect(state.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      baseAdjustmentRevision: 0,
      persistence: 'commit',
      source: 'ai-edit',
    });
  });

  test('rejects a stale pending command without changing patches, selection, or history', () => {
    const initialPatch = patch('survivor', ['child']);
    const initial = { ...structuredClone(INITIAL_ADJUSTMENTS), aiPatches: [initialPatch] };
    seedEditor(initial);
    useEditorStore.setState({
      activeAiPatchContainerId: 'survivor',
      activeAiSubMaskId: 'child',
    });

    const committed = useEditorStore.getState().applyAiEditCommand(({ aiPatches }) => {
      if (!aiPatches.some((candidate) => candidate.id === 'deleted-target')) return null;
      return {
        aiPatches,
        selection: { containerId: 'deleted-target', subMaskId: null },
      };
    });
    const state = useEditorStore.getState();

    expect(committed).toBeNull();
    expect(state.editDocumentV2.sourceArtifacts.aiPatches).toMatchObject([initialPatch]);
    expect(state.activeAiPatchContainerId).toBe('survivor');
    expect(state.activeAiSubMaskId).toBe('child');
    expect(state.historyIndex).toBe(0);
  });

  test('resolves an invalid requested child in the same commit that removes it', () => {
    const initialPatch = patch('first', ['removed']);
    const initial = { ...structuredClone(INITIAL_ADJUSTMENTS), aiPatches: [initialPatch] };
    seedEditor(initial);
    useEditorStore.setState({
      activeAiPatchContainerId: 'first',
      activeAiSubMaskId: 'removed',
    });

    useEditorStore.getState().applyAiEditCommand(({ aiPatches, selection }) => ({
      aiPatches: aiPatches.map((candidate) => ({ ...candidate, subMasks: [] })),
      selection,
    }));
    const state = useEditorStore.getState();

    expect(state.activeAiPatchContainerId).toBe('first');
    expect(state.activeAiSubMaskId).toBeNull();
  });

  test('commits visibility and deletion as independent source-artifact revisions with Undo', () => {
    const initial = { ...structuredClone(INITIAL_ADJUSTMENTS), aiPatches: [patch('first'), patch('second')] };
    seedEditor(initial);

    useEditorStore.getState().applyAiEditCommand(({ aiPatches, selection }) => ({
      aiPatches: aiPatches.map((candidate) =>
        candidate.id === 'first' ? { ...candidate, visible: false } : candidate,
      ),
      selection,
    }));
    expect(useEditorStore.getState().editDocumentV2.sourceArtifacts.aiPatches[0]?.visible).toBeFalse();
    expect(useEditorStore.getState().adjustmentRevision).toBe(1);
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().applyAiEditCommand(({ aiPatches, selection }) => ({
      aiPatches: aiPatches.filter((candidate) => candidate.id !== 'second'),
      selection,
    }));
    expect(useEditorStore.getState().editDocumentV2.sourceArtifacts.aiPatches.map((candidate) => candidate.id)).toEqual(
      ['first'],
    );
    expect(useEditorStore.getState().adjustmentRevision).toBe(2);
    expect(useEditorStore.getState().history).toHaveLength(3);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.sourceArtifacts.aiPatches.map((candidate) => candidate.id)).toEqual(
      ['first', 'second'],
    );
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.sourceArtifacts.aiPatches[0]?.visible).toBeTrue();
    expect(useEditorStore.getState().editDocumentV2.nodes['source_artifacts']?.params['aiPatches']).toEqual(
      useEditorStore.getState().editDocumentV2.sourceArtifacts.aiPatches,
    );
  });

  test('refuses a source-artifact transaction without a matching selected-image session', () => {
    const state = useEditorStore.getState();
    const matching = buildAiSourceArtifactEditTransaction(state, [patch('first')], 'matching');
    expect(matching).toMatchObject({
      baseAdjustmentRevision: 0,
      imageSessionId: imageSession.id,
      source: 'ai-edit',
    });
    expect(
      buildAiSourceArtifactEditTransaction(
        { ...state, imageSession: { ...imageSession, path: '/fixture/other.ARW' } },
        [patch('first')],
        'stale-source',
      ),
    ).toBeNull();
    expect(
      buildAiSourceArtifactEditTransaction({ ...state, imageSession: null }, [patch('first')], 'no-session'),
    ).toBeNull();
    expect(
      buildAiSourceArtifactEditTransaction({ ...state, selectedImage: null }, [patch('first')], 'no-source'),
    ).toBeNull();

    useEditorStore.setState({
      imageSession: createEditorImageSession({ generation: 99, path: sourcePath, source: 'cache' }),
    });
    expect(() => useEditorStore.getState().applyEditTransaction(required(matching))).toThrow(
      'edit_transaction.stale_session',
    );
  });

  test('treats an identical AI patch command as an exact transaction no-op', () => {
    const initial = { ...structuredClone(INITIAL_ADJUSTMENTS), aiPatches: [patch('first')] };
    seedEditor(initial);

    const committed = useEditorStore.getState().applyAiEditCommand(({ aiPatches, selection }) => ({
      aiPatches,
      selection,
    }));
    const state = useEditorStore.getState();

    expect(committed).toEqual({ containerId: null, subMaskId: null });
    expect(state.adjustmentRevision).toBe(0);
    expect(state.history).toHaveLength(1);
    expect(state.lastEditApplicationReceipt).toBeNull();
  });

  test('normalizes selection synchronously for reset, navigation, and history snapshots', () => {
    const populated = { ...structuredClone(INITIAL_ADJUSTMENTS), aiPatches: [patch('first', ['child'])] };
    seedEditor(populated);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeAiPatchContainerId: 'first',
      activeAiSubMaskId: 'child',
      historyIndex: 0,
      editDocumentV2: useEditorStore.getState().editDocumentV2,
      history: [useEditorStore.getState().editDocumentV2],
    });

    const neutralDocument = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      editDocumentV2: neutralDocument,
      history: [neutralDocument],
      historyIndex: 0,
    });
    expect(useEditorStore.getState().activeAiPatchContainerId).toBeNull();
    expect(useEditorStore.getState().activeAiSubMaskId).toBeNull();

    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeAiPatchContainerId: 'first',
      activeAiSubMaskId: 'child',
      historyIndex: 0,
      editDocumentV2: useEditorStore.getState().editDocumentV2,
      history: [useEditorStore.getState().editDocumentV2],
    });
    useEditorStore.getState().resetHistory(createDefaultEditDocumentV2());
    expect(useEditorStore.getState().activeAiPatchContainerId).toBeNull();
    expect(useEditorStore.getState().activeAiSubMaskId).toBeNull();
  });
});
