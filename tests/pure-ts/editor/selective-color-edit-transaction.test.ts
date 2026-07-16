import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  EditorPersistenceEffectRunner,
  type EditorPersistenceExecution,
} from '../../../src/utils/editorPersistenceEffectRunner';
import { hydrateImageOpenEditDocumentV2 } from '../../../src/utils/imageOpenAdjustmentHydration';
import {
  buildSelectiveColorEditTransaction,
  isCurrentSelectiveColorIdentity,
  type SelectiveColorCommitIdentity,
  type SelectiveColorMixerSettings,
} from '../../../src/utils/selectiveColorEditTransaction';

const sourcePath = '/fixture/selective-color.ARW';
const session = createEditorImageSession({ generation: 61, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<SelectiveColorCommitIdentity> = {}): SelectiveColorCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});
const initialMixer = (): SelectiveColorMixerSettings => ({
  hsl: structuredClone(INITIAL_ADJUSTMENTS.hsl),
  selectiveColorRangeControls: structuredClone(INITIAL_ADJUSTMENTS.selectiveColorRangeControls),
});

describe('selective color edit transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:selective-color-before',
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      imageSessionId: 61,
      lastEditApplicationReceipt: null,
      navigatorPreviewArtifact: {
        graphIdentity: 'graph:selective-color-before',
        id: 'navigator-before',
        imageSessionId: session.id,
        url: 'blob:navigator-before',
      },
      selectedImage,
      transformedOriginalUrl: 'blob:transformed-before',
      history: [editDocumentV2],
    });
  });

  test('commits HSL and range controls as one canonical output-invalidating history boundary', () => {
    const before = useEditorStore.getState();
    const beforeNode = before.editDocumentV2.nodes['selective_color_mixer'];
    const beforeTone = before.editDocumentV2.nodes['scene_global_color_tone'];
    const next = initialMixer();
    next.hsl.oranges = { ...next.hsl.oranges, saturation: 28 };
    next.selectiveColorRangeControls.oranges = {
      ...next.selectiveColorRangeControls.oranges,
      widthDegrees: 52,
    };

    const request = buildSelectiveColorEditTransaction(before, identity(), next, 'selective-color-orange');
    const result = before.applyEditTransaction(request);

    expect(request.operations).toEqual([
      {
        nodeType: 'selective_color_mixer',
        patch: { hsl: next.hsl, selectiveColorRangeControls: next.selectiveColorRangeControls },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['hsl', 'selectiveColorRangeControls'],
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
        transactionId: 'selective-color-orange',
      },
      navigatorPreviewArtifact: null,
      transformedOriginalUrl: null,
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().adjustmentSnapshot.value.hsl.oranges.saturation).toBe(28);
    expect(useEditorStore.getState().adjustmentSnapshot.value.selectiveColorRangeControls.oranges.widthDegrees).toBe(
      52,
    );
    expect(result.afterEditDocumentV2.nodes['selective_color_mixer']?.params).toEqual(next);
    expect(result.afterEditDocumentV2.nodes['selective_color_mixer']).not.toBe(beforeNode);
    expect(result.afterEditDocumentV2.nodes['scene_global_color_tone']).toBe(beforeTone);
    expect(result.afterEditDocumentV2.extensions['legacyAdjustments']).not.toHaveProperty('hsl');
    expect(result.afterEditDocumentV2.extensions['legacyAdjustments']).not.toHaveProperty(
      'selectiveColorRangeControls',
    );

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.hsl.oranges.saturation).toBe(0);
    expect(useEditorStore.getState().adjustmentSnapshot.value.selectiveColorRangeControls.oranges).toEqual(
      INITIAL_ADJUSTMENTS.selectiveColorRangeControls.oranges,
    );
    expect(useEditorStore.getState().editDocumentV2.nodes['selective_color_mixer']?.params).toEqual(initialMixer());
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().editDocumentV2.nodes['selective_color_mixer']?.params).toEqual(next);
  });

  test('carries selective-color node authority through save execution and reopen', async () => {
    const before = useEditorStore.getState();
    const beforeDocument = before.editDocumentV2;
    const next = initialMixer();
    next.hsl.reds = { hue: 18, luminance: 7, saturation: 31 };
    next.selectiveColorRangeControls.reds = {
      ...next.selectiveColorRangeControls.reds,
      falloffSmoothness: 2.25,
      widthDegrees: 48,
    };
    before.applyEditTransaction(buildSelectiveColorEditTransaction(before, identity(), next, 'save-selective-color'));
    const committed = useEditorStore.getState();
    const executions: EditorPersistenceExecution[] = [];
    const runner = new EditorPersistenceEffectRunner({
      clearTimer: () => {},
      execute: async (execution) => {
        executions.push(execution);
        return { path: execution.path, sidecarRevision: `sha256:${'c'.repeat(64)}` };
      },
      onAccepted: () => {},
      setTimer: (callback, _delayMs) => {
        callback();
        return setTimeout(() => {}, 0);
      },
    });
    runner.installSession({
      adjustmentRevision: 0,
      adjustments: { ...committed.adjustmentSnapshot.value, ...initialMixer() },
      editDocumentV2: beforeDocument,
      imageSessionId: session.id,
      path: sourcePath,
      sessionGeneration: session.generation,
    });
    if (committed.lastEditApplicationReceipt === null) throw new Error('missing committed selective-color receipt');
    runner.submitCommitted({
      adjustmentRevision: committed.adjustmentRevision,
      adjustments: committed.adjustmentSnapshot.value,
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
    expect(executions[0]?.editDocumentV2.nodes['selective_color_mixer']?.params).toEqual(next);
    const reopened = hydrateImageOpenEditDocumentV2(
      { adjustments: executions[0]?.adjustments, editDocumentV2: executions[0]?.editDocumentV2 },
      executions[0]?.adjustments ?? committed.adjustmentSnapshot.value,
    );
    expect(reopened.nodes['selective_color_mixer']?.params).toEqual(next);
    expect(reopened).toEqual(committed.editDocumentV2);
  });

  test('keeps exact no-ops inert and makes a whole-mixer reset one undoable transaction', () => {
    const before = useEditorStore.getState();
    const noOp = before.applyEditTransaction(
      buildSelectiveColorEditTransaction(before, identity(), initialMixer(), 'selective-color-no-op'),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      finalPreviewUrl: 'blob:selective-color-before',
      historyIndex: 0,
      lastEditApplicationReceipt: null,
      transformedOriginalUrl: 'blob:transformed-before',
    });

    const edited = initialMixer();
    edited.hsl.blues = { hue: -12, luminance: 7, saturation: 19 };
    edited.selectiveColorRangeControls.reds = {
      ...edited.selectiveColorRangeControls.reds,
      centerHueDegrees: 18,
    };
    before.applyEditTransaction(
      buildSelectiveColorEditTransaction(before, identity(), edited, 'selective-color-edited'),
    );
    const editedState = useEditorStore.getState();
    const resetResult = editedState.applyEditTransaction(
      buildSelectiveColorEditTransaction(
        editedState,
        identity({ adjustmentRevision: 1 }),
        initialMixer(),
        'selective-color-reset',
      ),
    );

    expect(resetResult).toMatchObject({
      changedKeys: ['hsl', 'selectiveColorRangeControls'],
      nextAdjustmentRevision: 2,
      noOp: false,
    });
    expect(useEditorStore.getState().history).toHaveLength(3);
    expect(useEditorStore.getState().adjustmentSnapshot.value.hsl).toEqual(INITIAL_ADJUSTMENTS.hsl);
    expect(useEditorStore.getState().adjustmentSnapshot.value.selectiveColorRangeControls).toEqual(
      INITIAL_ADJUSTMENTS.selectiveColorRangeControls,
    );

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.hsl.blues).toEqual(edited.hsl.blues);
    expect(useEditorStore.getState().adjustmentSnapshot.value.selectiveColorRangeControls.reds.centerHueDegrees).toBe(
      18,
    );
  });

  test('rejects stale path, explicit/fallback session, revision, and same-path reopen identities', () => {
    const explicitState = useEditorStore.getState();
    expect(() =>
      buildSelectiveColorEditTransaction(
        explicitState,
        identity({ sourceIdentity: '/fixture/other.ARW' }),
        initialMixer(),
        'stale-source',
      ),
    ).toThrow('selective_color_transaction.stale_source');
    expect(() =>
      buildSelectiveColorEditTransaction(
        explicitState,
        identity({ imageSessionId: 'stale-session' }),
        initialMixer(),
        'stale-session',
      ),
    ).toThrow('selective_color_transaction.stale_session');
    expect(() =>
      buildSelectiveColorEditTransaction(
        explicitState,
        identity({ adjustmentRevision: 1 }),
        initialMixer(),
        'stale-revision',
      ),
    ).toThrow('selective_color_transaction.stale_revision');

    useEditorStore.setState({ imageSession: null, imageSessionId: 71 });
    const fallbackState = useEditorStore.getState();
    const fallbackIdentity = identity({ imageSessionId: 'editor-image-session:71' });
    expect(isCurrentSelectiveColorIdentity(fallbackState, fallbackIdentity)).toBeTrue();
    const fallbackMixer = initialMixer();
    fallbackMixer.hsl.reds = { ...fallbackMixer.hsl.reds, hue: 9 };
    const fallbackResult = fallbackState.applyEditTransaction(
      buildSelectiveColorEditTransaction(fallbackState, fallbackIdentity, fallbackMixer, 'fallback-selective-color'),
    );
    expect(fallbackResult).toMatchObject({ changedKeys: ['hsl'], nextAdjustmentRevision: 1, noOp: false });
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      imageSessionId: fallbackIdentity.imageSessionId,
      transactionId: 'fallback-selective-color',
    });
    expect(
      isCurrentSelectiveColorIdentity(
        { ...fallbackState, imageSessionId: 72, selectedImage: { path: '/fixture/B.ARW' } },
        fallbackIdentity,
      ),
    ).toBeFalse();
    const reopenedA = { ...fallbackState, imageSessionId: 73 };
    expect(isCurrentSelectiveColorIdentity(reopenedA, fallbackIdentity)).toBeFalse();
    expect(() =>
      buildSelectiveColorEditTransaction(reopenedA, fallbackIdentity, initialMixer(), 'stale-reopened-a'),
    ).toThrow('selective_color_transaction.stale_session');
  });

  test('rejects non-finite and out-of-contract mixer values', () => {
    const state = useEditorStore.getState();
    const invalidHsl = initialMixer();
    invalidHsl.hsl.reds.hue = Number.NaN;
    expect(() => buildSelectiveColorEditTransaction(state, identity(), invalidHsl, 'invalid-hsl')).toThrow(
      'selective_color_transaction.invalid_hsl:reds:hue',
    );

    const invalidRange = initialMixer();
    invalidRange.selectiveColorRangeControls.blues.widthDegrees = 181;
    expect(() => buildSelectiveColorEditTransaction(state, identity(), invalidRange, 'invalid-range')).toThrow(
      'selective_color_transaction.invalid_range:blues:widthDegrees',
    );
  });
});
