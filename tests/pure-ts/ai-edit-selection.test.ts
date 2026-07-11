import { afterEach, describe, expect, test } from 'bun:test';
import { Mask, type SubMask, SubMaskMode, ToolType } from '../../src/components/panel/right/layers/Masks.tsx';
import { useEditorStore } from '../../src/store/useEditorStore.ts';
import type { AiPatch } from '../../src/utils/adjustments.ts';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments.ts';
import {
  resolveAiEditSelection,
  selectionAfterPatchDeletion,
  selectionAfterSubMaskDeletion,
} from '../../src/utils/aiEditSelection.ts';

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

afterEach(() => {
  useEditorStore.setState({
    activeAiPatchContainerId: null,
    activeAiSubMaskId: null,
    adjustments: structuredClone(INITIAL_ADJUSTMENTS),
    brushSettings: { feather: 50, size: 50, tool: ToolType.Brush },
    history: [structuredClone(INITIAL_ADJUSTMENTS)],
    historyIndex: 0,
  });
});

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
    useEditorStore.setState({
      adjustments: initial,
      activeAiPatchContainerId: 'first',
      activeAiSubMaskId: null,
      brushSettings: { feather: 25, size: 20, tool: ToolType.Eraser },
      history: [initial],
      historyIndex: 0,
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
    expect(state.adjustments.aiPatches[0]?.subMasks).toEqual([createdSubMask]);
    expect(state.activeAiPatchContainerId).toBe('first');
    expect(state.activeAiSubMaskId).toBe('created');
    expect(state.brushSettings?.tool).toBe(ToolType.Brush);
    expect(state.historyIndex).toBe(1);
    expect(state.history[1]).toBe(state.adjustments);
  });

  test('rejects a stale pending command without changing patches, selection, or history', () => {
    const initialPatch = patch('survivor', ['child']);
    const initial = { ...structuredClone(INITIAL_ADJUSTMENTS), aiPatches: [initialPatch] };
    useEditorStore.setState({
      adjustments: initial,
      activeAiPatchContainerId: 'survivor',
      activeAiSubMaskId: 'child',
      history: [initial],
      historyIndex: 0,
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
    expect(state.adjustments).toBe(initial);
    expect(state.activeAiPatchContainerId).toBe('survivor');
    expect(state.activeAiSubMaskId).toBe('child');
    expect(state.historyIndex).toBe(0);
  });

  test('resolves an invalid requested child in the same commit that removes it', () => {
    const initialPatch = patch('first', ['removed']);
    const initial = { ...structuredClone(INITIAL_ADJUSTMENTS), aiPatches: [initialPatch] };
    useEditorStore.setState({
      adjustments: initial,
      activeAiPatchContainerId: 'first',
      activeAiSubMaskId: 'removed',
      history: [initial],
      historyIndex: 0,
    });

    useEditorStore.getState().applyAiEditCommand(({ aiPatches, selection }) => ({
      aiPatches: aiPatches.map((candidate) => ({ ...candidate, subMasks: [] })),
      selection,
    }));
    const state = useEditorStore.getState();

    expect(state.activeAiPatchContainerId).toBe('first');
    expect(state.activeAiSubMaskId).toBeNull();
  });

  test('normalizes selection synchronously for reset, navigation, and history snapshots', () => {
    const populated = { ...structuredClone(INITIAL_ADJUSTMENTS), aiPatches: [patch('first', ['child'])] };
    useEditorStore.setState({
      adjustments: populated,
      activeAiPatchContainerId: 'first',
      activeAiSubMaskId: 'child',
      history: [populated],
      historyIndex: 0,
    });

    useEditorStore.getState().setEditor({ adjustments: structuredClone(INITIAL_ADJUSTMENTS) });
    expect(useEditorStore.getState().activeAiPatchContainerId).toBeNull();
    expect(useEditorStore.getState().activeAiSubMaskId).toBeNull();

    useEditorStore.setState({
      adjustments: populated,
      activeAiPatchContainerId: 'first',
      activeAiSubMaskId: 'child',
      history: [populated],
      historyIndex: 0,
    });
    useEditorStore.getState().resetHistory(structuredClone(INITIAL_ADJUSTMENTS));
    expect(useEditorStore.getState().activeAiPatchContainerId).toBeNull();
    expect(useEditorStore.getState().activeAiSubMaskId).toBeNull();
  });
});
