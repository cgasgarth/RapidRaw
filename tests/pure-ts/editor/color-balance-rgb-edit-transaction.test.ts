import { beforeEach, describe, expect, test } from 'bun:test';

import type { ColorBalanceRgbSettings } from '../../../src/schemas/color/colorBalanceRgbSchemas';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildColorBalanceRgbEditTransaction,
  type ColorBalanceRgbCommitIdentity,
  isCurrentColorBalanceRgbIdentity,
} from '../../../src/utils/colorBalanceRgbEditTransaction';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  EditorPersistenceEffectRunner,
  type EditorPersistenceExecution,
} from '../../../src/utils/editorPersistenceEffectRunner';
import { hydrateImageOpenEditDocumentV2 } from '../../../src/utils/imageOpenAdjustmentHydration';

const sourcePath = '/fixture/color-balance-rgb.ARW';
const session = createEditorImageSession({ generation: 73, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<ColorBalanceRgbCommitIdentity> = {}): ColorBalanceRgbCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});
const initialColorBalance = (): ColorBalanceRgbSettings => structuredClone(INITIAL_ADJUSTMENTS.colorBalanceRgb);

describe('Color Balance RGB edit transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:color-balance-before',
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      imageSessionId: 73,
      lastEditApplicationReceipt: null,
      navigatorPreviewArtifact: null,
      selectedImage,
      transformedOriginalUrl: 'blob:color-balance-transformed-before',
      history: [editDocumentV2],
    });
  });

  test('commits one RGB change with receipt, output invalidation, and complete Undo/Redo', () => {
    const before = useEditorStore.getState();
    const beforeNode = before.editDocumentV2.nodes['color_balance_rgb'];
    const beforeTone = before.editDocumentV2.nodes['scene_global_color_tone'];
    const next = initialColorBalance();
    next.midtones = { ...next.midtones, red: 24 };
    next.enabled = true;

    const request = buildColorBalanceRgbEditTransaction(before, identity(), next, 'color-balance-midtones-red');
    const result = before.applyEditTransaction(request);

    expect(request.operations).toEqual([
      { nodeType: 'color_balance_rgb', patch: { colorBalanceRgb: next }, type: 'patch-edit-document-node' },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['nodes.color_balance_rgb.params.colorBalanceRgb'],
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
        transactionId: 'color-balance-midtones-red',
      },
      transformedOriginalUrl: null,
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().adjustmentSnapshot.value.colorBalanceRgb).toEqual(next);
    expect(result.after.nodes['color_balance_rgb']?.params).toMatchObject({ colorBalanceRgb: next });
    expect(result.after.nodes['color_balance_rgb']).not.toBe(beforeNode);
    expect(result.after.nodes['scene_global_color_tone']).toBe(beforeTone);
    expect(result.after.extensions['legacyAdjustments']).not.toHaveProperty('colorBalanceRgb');

    useEditorStore.getState().undo();
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'color_balance_rgb').params['colorBalanceRgb'],
    ).toEqual(INITIAL_ADJUSTMENTS.colorBalanceRgb);
    expect(useEditorStore.getState().editDocumentV2.nodes['color_balance_rgb']?.params).toMatchObject({
      colorBalanceRgb: INITIAL_ADJUSTMENTS.colorBalanceRgb,
    });
    useEditorStore.getState().redo();
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'color_balance_rgb').params['colorBalanceRgb'],
    ).toEqual(next);
    expect(useEditorStore.getState().editDocumentV2.nodes['color_balance_rgb']?.params).toMatchObject({
      colorBalanceRgb: next,
    });
  });

  test('carries Color Balance RGB node authority through save execution and reopen', async () => {
    const before = useEditorStore.getState();
    const beforeDocument = before.editDocumentV2;
    const next = initialColorBalance();
    next.enabled = true;
    next.shadows = { ...next.shadows, blue: -16 };
    before.applyEditTransaction(
      buildColorBalanceRgbEditTransaction(before, identity(), next, 'save-color-balance-rgb'),
    );
    const committed = useEditorStore.getState();
    const executions: EditorPersistenceExecution[] = [];
    const runner = new EditorPersistenceEffectRunner({
      clearTimer: () => {},
      execute: async (execution) => {
        executions.push(execution);
        return { path: execution.path, sidecarRevision: `sha256:${'a'.repeat(64)}` };
      },
      onAccepted: () => {},
      setTimer: (callback, _delayMs) => {
        callback();
        return setTimeout(() => {}, 0);
      },
    });
    runner.installSession({
      adjustmentRevision: 0,
      editDocumentV2: beforeDocument,
      imageSessionId: session.id,
      path: sourcePath,
      sessionGeneration: session.generation,
    });
    if (committed.lastEditApplicationReceipt === null) throw new Error('missing committed color balance receipt');
    runner.submitCommitted({
      adjustmentRevision: committed.adjustmentRevision,
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
    expect(executions[0]?.editDocumentV2.nodes['color_balance_rgb']?.params).toMatchObject({ colorBalanceRgb: next });
    const reopened = hydrateImageOpenEditDocumentV2({ editDocumentV2: executions[0]?.editDocumentV2 });
    expect(reopened.nodes['color_balance_rgb']?.params).toMatchObject({ colorBalanceRgb: next });
    expect(reopened).toEqual(committed.editDocumentV2);
  });

  test('keeps no-ops inert and makes range/full resets single undoable boundaries', () => {
    const before = useEditorStore.getState();
    const noOp = before.applyEditTransaction(
      buildColorBalanceRgbEditTransaction(before, identity(), initialColorBalance(), 'color-balance-no-op'),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      finalPreviewUrl: 'blob:color-balance-before',
      historyIndex: 0,
      lastEditApplicationReceipt: null,
      transformedOriginalUrl: 'blob:color-balance-transformed-before',
    });

    const edited = initialColorBalance();
    edited.enabled = true;
    edited.preserveLuminance = false;
    edited.shadows = { blue: 11, green: -7, red: 16 };
    edited.highlights = { ...edited.highlights, blue: -19 };
    before.applyEditTransaction(
      buildColorBalanceRgbEditTransaction(before, identity(), edited, 'color-balance-edited'),
    );

    const editedState = useEditorStore.getState();
    const rangeReset = structuredClone(
      selectEditDocumentNode(editedState.editDocumentV2, 'color_balance_rgb').params['colorBalanceRgb'],
    );
    rangeReset.shadows = structuredClone(INITIAL_ADJUSTMENTS.colorBalanceRgb.shadows);
    const rangeResult = editedState.applyEditTransaction(
      buildColorBalanceRgbEditTransaction(
        editedState,
        identity({ adjustmentRevision: 1 }),
        rangeReset,
        'color-balance-reset-shadows',
      ),
    );
    expect(rangeResult).toMatchObject({
      changedKeys: ['nodes.color_balance_rgb.params.colorBalanceRgb'],
      nextAdjustmentRevision: 2,
      noOp: false,
    });
    expect(useEditorStore.getState().adjustmentSnapshot.value.colorBalanceRgb.shadows).toEqual(
      INITIAL_ADJUSTMENTS.colorBalanceRgb.shadows,
    );
    expect(useEditorStore.getState().adjustmentSnapshot.value.colorBalanceRgb.highlights.blue).toBe(-19);

    const rangeResetState = useEditorStore.getState();
    rangeResetState.applyEditTransaction(
      buildColorBalanceRgbEditTransaction(
        rangeResetState,
        identity({ adjustmentRevision: 2 }),
        initialColorBalance(),
        'color-balance-reset-all',
      ),
    );
    expect(useEditorStore.getState().history).toHaveLength(4);
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'color_balance_rgb').params['colorBalanceRgb'],
    ).toEqual(INITIAL_ADJUSTMENTS.colorBalanceRgb);
    useEditorStore.getState().undo();
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'color_balance_rgb').params['colorBalanceRgb'],
    ).toEqual(rangeReset);
  });

  test('rejects stale path/session/revision and same-path fallback-session reopen identities', () => {
    const explicitState = useEditorStore.getState();
    expect(() =>
      buildColorBalanceRgbEditTransaction(
        explicitState,
        identity({ sourceIdentity: '/fixture/other.ARW' }),
        initialColorBalance(),
        'stale-source',
      ),
    ).toThrow('color_balance_rgb_transaction.stale_source');
    expect(() =>
      buildColorBalanceRgbEditTransaction(
        explicitState,
        identity({ imageSessionId: 'stale-session' }),
        initialColorBalance(),
        'stale-session',
      ),
    ).toThrow('color_balance_rgb_transaction.stale_session');
    expect(() =>
      buildColorBalanceRgbEditTransaction(
        explicitState,
        identity({ adjustmentRevision: 1 }),
        initialColorBalance(),
        'stale-revision',
      ),
    ).toThrow('color_balance_rgb_transaction.stale_revision');

    useEditorStore.setState({ imageSession: null, imageSessionId: 81 });
    const fallbackState = useEditorStore.getState();
    const fallbackIdentity = identity({ imageSessionId: 'editor-image-session:81' });
    expect(isCurrentColorBalanceRgbIdentity(fallbackState, fallbackIdentity)).toBeTrue();
    const fallbackSettings = initialColorBalance();
    fallbackSettings.preserveLuminance = false;
    const fallbackResult = fallbackState.applyEditTransaction(
      buildColorBalanceRgbEditTransaction(fallbackState, fallbackIdentity, fallbackSettings, 'fallback-color-balance'),
    );
    expect(fallbackResult).toMatchObject({
      changedKeys: ['nodes.color_balance_rgb.params.colorBalanceRgb'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      imageSessionId: fallbackIdentity.imageSessionId,
      transactionId: 'fallback-color-balance',
    });

    const reopenedA = { ...fallbackState, imageSessionId: 83 };
    expect(
      isCurrentColorBalanceRgbIdentity(
        { ...fallbackState, imageSessionId: 82, selectedImage: { path: '/fixture/B.ARW' } },
        fallbackIdentity,
      ),
    ).toBeFalse();
    expect(isCurrentColorBalanceRgbIdentity(reopenedA, fallbackIdentity)).toBeFalse();
    expect(() =>
      buildColorBalanceRgbEditTransaction(reopenedA, fallbackIdentity, fallbackSettings, 'stale-reopened-a'),
    ).toThrow('color_balance_rgb_transaction.stale_session');
  });

  test('rejects malformed toggles plus non-finite and out-of-range channels', () => {
    const state = useEditorStore.getState();
    const invalidToggle = initialColorBalance();
    Reflect.set(invalidToggle, 'enabled', 'yes');
    expect(() => buildColorBalanceRgbEditTransaction(state, identity(), invalidToggle, 'invalid-toggle')).toThrow(
      'color_balance_rgb_transaction.invalid_toggle',
    );

    const nonFinite = initialColorBalance();
    nonFinite.midtones.green = Number.NaN;
    expect(() => buildColorBalanceRgbEditTransaction(state, identity(), nonFinite, 'non-finite')).toThrow(
      'color_balance_rgb_transaction.invalid_channel:midtones:green',
    );
    const outOfRange = initialColorBalance();
    outOfRange.highlights.blue = 101;
    expect(() => buildColorBalanceRgbEditTransaction(state, identity(), outOfRange, 'out-of-range')).toThrow(
      'color_balance_rgb_transaction.invalid_channel:highlights:blue',
    );

    const identityEnabled = initialColorBalance();
    identityEnabled.enabled = true;
    expect(() => buildColorBalanceRgbEditTransaction(state, identity(), identityEnabled, 'identity-enabled')).toThrow(
      'color_balance_rgb_transaction.enabled_identity',
    );
  });
});
