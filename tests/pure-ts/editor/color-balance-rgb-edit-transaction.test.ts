import { beforeEach, describe, expect, test } from 'bun:test';

import type { ColorBalanceRgbSettings } from '../../../src/schemas/color/colorBalanceRgbSchemas';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildColorBalanceRgbEditTransaction,
  type ColorBalanceRgbCommitIdentity,
  isCurrentColorBalanceRgbIdentity,
} from '../../../src/utils/colorBalanceRgbEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

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
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      finalPreviewUrl: 'blob:color-balance-before',
      history: [adjustments],
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      imageSessionId: 73,
      lastEditApplicationReceipt: null,
      navigatorPreviewArtifact: null,
      selectedImage,
      transformedOriginalUrl: 'blob:color-balance-transformed-before',
    });
  });

  test('commits one RGB change with receipt, output invalidation, and complete Undo/Redo', () => {
    const before = useEditorStore.getState();
    const next = initialColorBalance();
    next.midtones = { ...next.midtones, red: 24 };
    next.enabled = true;

    const result = before.applyEditTransaction(
      buildColorBalanceRgbEditTransaction(before, identity(), next, 'color-balance-midtones-red'),
    );

    expect(result).toMatchObject({
      changedKeys: ['colorBalanceRgb'],
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
    expect(useEditorStore.getState().adjustments.colorBalanceRgb).toEqual(next);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.colorBalanceRgb).toEqual(INITIAL_ADJUSTMENTS.colorBalanceRgb);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().adjustments.colorBalanceRgb).toEqual(next);
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
    const rangeReset = structuredClone(editedState.adjustments.colorBalanceRgb);
    rangeReset.shadows = structuredClone(INITIAL_ADJUSTMENTS.colorBalanceRgb.shadows);
    const rangeResult = editedState.applyEditTransaction(
      buildColorBalanceRgbEditTransaction(
        editedState,
        identity({ adjustmentRevision: 1 }),
        rangeReset,
        'color-balance-reset-shadows',
      ),
    );
    expect(rangeResult).toMatchObject({ changedKeys: ['colorBalanceRgb'], nextAdjustmentRevision: 2, noOp: false });
    expect(useEditorStore.getState().adjustments.colorBalanceRgb.shadows).toEqual(
      INITIAL_ADJUSTMENTS.colorBalanceRgb.shadows,
    );
    expect(useEditorStore.getState().adjustments.colorBalanceRgb.highlights.blue).toBe(-19);

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
    expect(useEditorStore.getState().adjustments.colorBalanceRgb).toEqual(INITIAL_ADJUSTMENTS.colorBalanceRgb);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.colorBalanceRgb).toEqual(rangeReset);
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
    expect(fallbackResult).toMatchObject({ changedKeys: ['colorBalanceRgb'], nextAdjustmentRevision: 1, noOp: false });
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
  });
});
