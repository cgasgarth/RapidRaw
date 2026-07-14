import { afterEach, describe, expect, test } from 'bun:test';

import { useEditorStore } from '../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS, INITIAL_MASK_ADJUSTMENTS } from '../../src/utils/adjustments';
import {
  buildEditTransactionPersistenceContext,
  type EditTransactionRequest,
  reduceEditTransaction,
} from '../../src/utils/editTransaction';
import { buildLayerEditTransactionRequest } from '../../src/utils/layers/layerEditTransaction';

const request = (overrides: Partial<EditTransactionRequest> = {}): EditTransactionRequest => ({
  transactionId: 'tx-1',
  imageSessionId: 'session-1',
  baseAdjustmentRevision: 4,
  source: 'manual-control',
  operations: [{ type: 'patch-adjustments', patch: { exposure: 0.5 } }],
  history: 'single-entry',
  persistence: 'commit',
  ...overrides,
});

afterEach(() => {
  const initial = structuredClone(INITIAL_ADJUSTMENTS);
  useEditorStore.setState({
    adjustments: initial,
    adjustmentRevision: 0,
    history: [initial],
    historyCheckpoints: [],
    historyIndex: 0,
  });
});

describe('reduceEditTransaction', () => {
  test('applies semantic patch operations and advances the revision once', () => {
    const result = reduceEditTransaction(INITIAL_ADJUSTMENTS, 4, request());

    expect(result.after.exposure).toBe(0.5);
    expect(result.changedKeys).toEqual(['exposure']);
    expect(result.nextAdjustmentRevision).toBe(5);
    expect(result.noOp).toBe(false);
    expect(result.applicationReceipt).toMatchObject({
      transactionId: 'tx-1',
      imageSessionId: 'session-1',
      adjustmentRevision: 5,
    });
    expect(result.invalidatedStages).toEqual(['preview', 'navigator', 'thumbnail']);
    expect(result.invalidatedProvenance).toEqual(['reference-match', 'auto-edit', 'derived-render']);
    expect(buildEditTransactionPersistenceContext(request(), result)).toEqual({
      transactionId: 'tx-1',
      imageSessionId: 'session-1',
      baseAdjustmentRevision: 4,
      nextAdjustmentRevision: 5,
    });
  });

  test('exact no-ops do not advance revision or create a changed-key set', () => {
    const result = reduceEditTransaction(
      INITIAL_ADJUSTMENTS,
      4,
      request({
        operations: [{ type: 'patch-adjustments', patch: { exposure: INITIAL_ADJUSTMENTS.exposure } }],
      }),
    );

    expect(result.noOp).toBe(true);
    expect(result.changedKeys).toEqual([]);
    expect(result.nextAdjustmentRevision).toBe(4);
  });

  test('rejects stale proposals before applying any operation', () => {
    expect(() => reduceEditTransaction(INITIAL_ADJUSTMENTS, 5, request())).toThrow('edit_transaction.stale_base:4:5');
  });

  test('rejects proposals from an older image session before reducing operations', () => {
    expect(() => reduceEditTransaction(INITIAL_ADJUSTMENTS, 4, request(), 'session-2')).toThrow(
      'edit_transaction.stale_session:session-1:session-2',
    );
  });

  test('rejects non-finite numeric values at the transaction boundary', () => {
    expect(() =>
      reduceEditTransaction(
        INITIAL_ADJUSTMENTS,
        4,
        request({ operations: [{ type: 'patch-adjustments', patch: { exposure: Number.NaN } }] }),
      ),
    ).toThrow('edit_transaction.invalid_value:exposure');
  });

  test('store commit publishes one canonical state and one history boundary', () => {
    const result = useEditorStore
      .getState()
      .applyEditTransaction(request({ baseAdjustmentRevision: 0, imageSessionId: 'editor-image-session:1' }));
    const state = useEditorStore.getState();

    expect(result.changedKeys).toEqual(['exposure']);
    expect(state.adjustments.exposure).toBe(0.5);
    expect(state.adjustmentRevision).toBe(1);
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
  });

  test('layer commands publish canonical state and history through the authority', () => {
    const next = {
      ...INITIAL_ADJUSTMENTS,
      masks: [
        {
          adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
          id: 'layer-1',
          invert: false,
          name: 'Layer 1',
          opacity: 100,
          subMasks: [],
          visible: false,
        },
      ],
    };
    const result = useEditorStore.getState().applyEditTransaction(
      request({
        transactionId: 'layer-1',
        baseAdjustmentRevision: 0,
        imageSessionId: 'editor-image-session:1',
        source: 'layer-command',
        operations: [{ type: 'replace-adjustments', adjustments: next }],
      }),
    );
    const state = useEditorStore.getState();

    expect(result.applicationReceipt.source).toBe('layer-command');
    expect(state.adjustments.masks).toEqual(next.masks);
    expect(state.history).toHaveLength(2);
  });

  test('layer command boundary carries session/revision identity into persistence', () => {
    const next = {
      ...INITIAL_ADJUSTMENTS,
      masks: [
        {
          adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
          id: 'layer-persisted',
          invert: false,
          name: 'Layer persisted',
          opacity: 100,
          subMasks: [],
          visible: true,
        },
      ],
    };
    const request = buildLayerEditTransactionRequest(
      {
        adjustmentRevision: 7,
        adjustments: INITIAL_ADJUSTMENTS,
        imageSessionId: 4,
        imageSession: { id: 'session-layer' },
      },
      next,
      'layer-persist-1',
    );
    const result = reduceEditTransaction(INITIAL_ADJUSTMENTS, 7, request, 'session-layer');
    const persistence = buildEditTransactionPersistenceContext(request, result);

    expect(result.applicationReceipt).toMatchObject({
      transactionId: 'layer-persist-1',
      imageSessionId: 'session-layer',
      baseAdjustmentRevision: 7,
      adjustmentRevision: 8,
    });
    expect(persistence).toEqual({
      transactionId: 'layer-persist-1',
      imageSessionId: 'session-layer',
      baseAdjustmentRevision: 7,
      nextAdjustmentRevision: 8,
    });
    expect(() => reduceEditTransaction(INITIAL_ADJUSTMENTS, 8, request, 'session-layer')).toThrow(
      'edit_transaction.stale_base:7:8',
    );
    expect(() => reduceEditTransaction(INITIAL_ADJUSTMENTS, 7, request, 'session-other')).toThrow(
      'edit_transaction.stale_session:session-layer:session-other',
    );
  });
});
