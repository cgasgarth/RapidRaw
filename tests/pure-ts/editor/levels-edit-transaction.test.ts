import { beforeEach, describe, expect, test } from 'bun:test';

import type { LevelsSettings } from '../../../src/schemas/color/levelsSchemas';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  EditorPersistenceEffectRunner,
  type EditorPersistenceExecution,
} from '../../../src/utils/editorPersistenceEffectRunner';
import { hydrateImageOpenEditDocumentV2 } from '../../../src/utils/imageOpenAdjustmentHydration';
import {
  buildLevelsEditTransaction,
  isCurrentLevelsIdentity,
  type LevelsCommitIdentity,
} from '../../../src/utils/levelsEditTransaction';

const sourcePath = '/fixture/levels.ARW';
const session = createEditorImageSession({ generation: 91, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<LevelsCommitIdentity> = {}): LevelsCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});
const initialLevels = (): LevelsSettings => structuredClone(INITIAL_ADJUSTMENTS.levels);

describe('Levels edit transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:levels-before',
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      imageSessionId: 91,
      lastEditApplicationReceipt: null,
      navigatorPreviewArtifact: null,
      selectedImage,
      transformedOriginalUrl: 'blob:levels-transformed-before',
      history: [editDocumentV2],
    });
  });

  test('commits one validated Levels action with receipt, invalidation, and Undo/Redo', () => {
    const before = useEditorStore.getState();
    const beforeNode = before.editDocumentV2.nodes.luma_levels;
    const beforeTone = before.editDocumentV2.nodes.scene_global_color_tone;
    const next = initialLevels();
    next.enabled = true;
    next.inputBlack = 0.08;
    next.inputWhite = 0.94;
    next.gamma = 1.18;
    next.outputBlack = 0.03;
    next.outputWhite = 0.97;

    const request = buildLevelsEditTransaction(before, identity(), next, 'levels-global-change');
    const result = before.applyEditTransaction(request);

    expect(request.operations).toEqual([
      { nodeType: 'luma_levels', patch: { levels: next }, type: 'patch-edit-document-node' },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['levels'],
      invalidatedStages: ['preview', 'navigator', 'thumbnail'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 1,
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: session.id,
        source: 'manual-control',
        transactionId: 'levels-global-change',
      },
      transformedOriginalUrl: null,
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().adjustmentSnapshot.value.levels).toEqual(next);
    expect(result.afterEditDocumentV2.nodes.luma_levels.params.levels).toEqual(next);
    expect(result.afterEditDocumentV2.nodes.luma_levels).not.toBe(beforeNode);
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone).toBe(beforeTone);
    expect(result.afterEditDocumentV2.extensions.legacyAdjustments).not.toHaveProperty('levels');

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.levels).toEqual(INITIAL_ADJUSTMENTS.levels);
    expect(useEditorStore.getState().editDocumentV2.nodes.luma_levels.params.levels).toEqual(
      INITIAL_ADJUSTMENTS.levels,
    );
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.levels).toEqual(next);
    expect(useEditorStore.getState().editDocumentV2.nodes.luma_levels.params.levels).toEqual(next);
  });

  test('carries Levels node authority through save execution and reopen', async () => {
    const before = useEditorStore.getState();
    const beforeDocument = before.editDocumentV2;
    const next = initialLevels();
    next.enabled = true;
    next.gamma = 1.4;
    next.inputBlack = 0.05;
    before.applyEditTransaction(buildLevelsEditTransaction(before, identity(), next, 'save-levels'));
    const committed = useEditorStore.getState();
    const executions: EditorPersistenceExecution[] = [];
    const runner = new EditorPersistenceEffectRunner({
      clearTimer: () => {},
      execute: async (execution) => {
        executions.push(execution);
        return { path: execution.path, sidecarRevision: `sha256:${'b'.repeat(64)}` };
      },
      onAccepted: () => {},
      setTimer: (callback) => {
        callback();
        return 0;
      },
    });
    runner.installSession({
      adjustmentRevision: 0,
      adjustments: { ...committed.adjustments, levels: initialLevels() },
      editDocumentV2: beforeDocument,
      imageSessionId: session.id,
      path: sourcePath,
      sessionGeneration: session.generation,
    });
    if (committed.lastEditApplicationReceipt === null) throw new Error('missing committed Levels receipt');
    runner.submitCommitted({
      adjustmentRevision: committed.adjustmentRevision,
      adjustments: committed.adjustments,
      editDocumentV2: committed.editDocumentV2,
      imageSessionId: session.id,
      interactionActive: false,
      multiSelection: null,
      path: sourcePath,
      receipt: committed.lastEditApplicationReceipt,
      sessionGeneration: session.generation,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(executions).toHaveLength(1);
    expect(executions[0]?.editDocumentV2.nodes.luma_levels.params.levels).toEqual(next);
    const reopened = hydrateImageOpenEditDocumentV2(
      { adjustments: executions[0]?.adjustments, editDocumentV2: executions[0]?.editDocumentV2 },
      executions[0]?.adjustments ?? committed.adjustments,
    );
    expect(reopened.nodes.luma_levels.params.levels).toEqual(next);
    expect(reopened).toEqual(committed.editDocumentV2);
  });

  test('keeps exact no-ops inert and makes reset one undoable action', () => {
    const before = useEditorStore.getState();
    const noOp = before.applyEditTransaction(
      buildLevelsEditTransaction(before, identity(), initialLevels(), 'levels-no-op'),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      finalPreviewUrl: 'blob:levels-before',
      historyIndex: 0,
      lastEditApplicationReceipt: null,
      transformedOriginalUrl: 'blob:levels-transformed-before',
    });

    const edited = initialLevels();
    edited.enabled = true;
    edited.gamma = 1.35;
    before.applyEditTransaction(buildLevelsEditTransaction(before, identity(), edited, 'levels-edited'));
    const editedState = useEditorStore.getState();
    const reset = editedState.applyEditTransaction(
      buildLevelsEditTransaction(editedState, identity({ adjustmentRevision: 1 }), initialLevels(), 'levels-reset'),
    );
    expect(reset).toMatchObject({ changedKeys: ['levels'], nextAdjustmentRevision: 2, noOp: false });
    expect(useEditorStore.getState().history).toHaveLength(3);
    expect(useEditorStore.getState().adjustmentSnapshot.value.levels).toEqual(INITIAL_ADJUSTMENTS.levels);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.levels).toEqual(edited);
  });

  test('rejects stale path/session/revision and same-path fallback-session reopen identities', () => {
    const explicitState = useEditorStore.getState();
    expect(() =>
      buildLevelsEditTransaction(
        explicitState,
        identity({ sourceIdentity: '/fixture/other.ARW' }),
        initialLevels(),
        'stale-source',
      ),
    ).toThrow('levels_transaction.stale_source');
    expect(() =>
      buildLevelsEditTransaction(
        explicitState,
        identity({ imageSessionId: 'stale-session' }),
        initialLevels(),
        'stale-session',
      ),
    ).toThrow('levels_transaction.stale_session');
    expect(() =>
      buildLevelsEditTransaction(explicitState, identity({ adjustmentRevision: 1 }), initialLevels(), 'stale-revision'),
    ).toThrow('levels_transaction.stale_revision');

    useEditorStore.setState({ imageSession: null, imageSessionId: 101 });
    const fallbackState = useEditorStore.getState();
    const fallbackIdentity = identity({ imageSessionId: 'editor-image-session:101' });
    expect(isCurrentLevelsIdentity(fallbackState, fallbackIdentity)).toBeTrue();
    const fallbackLevels = initialLevels();
    fallbackLevels.gamma = 1.25;
    const fallbackResult = fallbackState.applyEditTransaction(
      buildLevelsEditTransaction(fallbackState, fallbackIdentity, fallbackLevels, 'fallback-levels'),
    );
    expect(fallbackResult).toMatchObject({ changedKeys: ['levels'], nextAdjustmentRevision: 1, noOp: false });
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      imageSessionId: fallbackIdentity.imageSessionId,
      transactionId: 'fallback-levels',
    });

    expect(
      isCurrentLevelsIdentity(
        { ...fallbackState, imageSessionId: 102, selectedImage: { path: '/fixture/B.ARW' } },
        fallbackIdentity,
      ),
    ).toBeFalse();
    const reopenedA = { ...fallbackState, imageSessionId: 103 };
    expect(isCurrentLevelsIdentity(reopenedA, fallbackIdentity)).toBeFalse();
    expect(() => buildLevelsEditTransaction(reopenedA, fallbackIdentity, fallbackLevels, 'stale-reopened-a')).toThrow(
      'levels_transaction.stale_session',
    );
  });

  test('rejects non-finite, out-of-range, and cross-field-invalid Levels documents', () => {
    const state = useEditorStore.getState();
    const nonFinite = initialLevels();
    nonFinite.gamma = Number.NaN;
    expect(() => buildLevelsEditTransaction(state, identity(), nonFinite, 'non-finite')).toThrow(
      'levels_transaction.invalid_levels:gamma',
    );
    const outOfRange = initialLevels();
    outOfRange.outputWhite = 1.1;
    expect(() => buildLevelsEditTransaction(state, identity(), outOfRange, 'out-of-range')).toThrow(
      'levels_transaction.invalid_levels:outputWhite',
    );
    const invalidInput = initialLevels();
    invalidInput.inputBlack = invalidInput.inputWhite;
    expect(() => buildLevelsEditTransaction(state, identity(), invalidInput, 'invalid-input')).toThrow(
      'levels_transaction.invalid_levels:inputBlack',
    );
    const invalidOutput = initialLevels();
    invalidOutput.outputBlack = invalidOutput.outputWhite;
    expect(() => buildLevelsEditTransaction(state, identity(), invalidOutput, 'invalid-output')).toThrow(
      'levels_transaction.invalid_levels:outputBlack',
    );
  });
});
