import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import { useEditorStore } from '../../src/store/useEditorStore';
import { createDefaultMaskEditNodes, INITIAL_ADJUSTMENTS, INITIAL_MASK_ADJUSTMENTS } from '../../src/utils/adjustments';
import {
  selectEditDocumentGeometry,
  selectEditDocumentLayers,
  selectEditDocumentNode,
} from '../../src/utils/editDocumentSelectors';
import { legacyAdjustmentsToEditDocumentV2, setEditDocumentV2NodeEnabled } from '../../src/utils/editDocumentV2';
import {
  buildEditorSectionNodeEnablementOperations,
  buildEditTransactionPersistenceContext,
  type EditTransactionRequest,
  reduceEditTransaction,
} from '../../src/utils/editTransaction';
import { buildLayerEditTransactionRequest } from '../../src/utils/layers/layerEditTransaction';

const defaultDocument = (): EditDocumentV2 => legacyAdjustmentsToEditDocumentV2(structuredClone(INITIAL_ADJUSTMENTS));

const request = (overrides: Partial<EditTransactionRequest> = {}): EditTransactionRequest => ({
  baseAdjustmentRevision: 4,
  history: 'single-entry',
  imageSessionId: 'session-1',
  operations: [
    {
      nodeType: 'scene_global_color_tone',
      patch: { exposure: 0.5 },
      type: 'patch-edit-document-node',
    },
  ],
  persistence: 'commit',
  source: 'manual-control',
  transactionId: 'tx-1',
  ...overrides,
});

const resetEditorState = () => {
  const editDocumentV2 = defaultDocument();
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    history: [editDocumentV2],
    historyCheckpoints: [],
    historyIndex: 0,
  });
};

beforeEach(resetEditorState);
afterEach(resetEditorState);

describe('reduceEditTransaction typed authority', () => {
  test('patches one descriptor-owned node and preserves unrelated identities', () => {
    const before = defaultDocument();
    const result = reduceEditTransaction(before, 4, request());

    expect(selectEditDocumentNode(result.after, 'scene_global_color_tone').params.exposure).toBe(0.5);
    expect(result.changedKeys).toEqual(['nodes.scene_global_color_tone.params.exposure']);
    expect(result.nextAdjustmentRevision).toBe(5);
    expect(result.noOp).toBeFalse();
    expect(result.after.nodes['geometry']).toBe(before.nodes['geometry']);
    expect(result.after.nodes['scene_curve']).toBe(before.nodes['scene_curve']);
    expect(result.invalidatedStages).toEqual(['preview', 'navigator', 'thumbnail']);
    expect(result.invalidatedProvenance).toEqual(['reference-match', 'auto-edit', 'derived-render']);
    expect(result.applicationReceipt).toMatchObject({
      adjustmentRevision: 5,
      imageSessionId: 'session-1',
      transactionId: 'tx-1',
    });
    expect(buildEditTransactionPersistenceContext(request(), result)).toEqual({
      baseAdjustmentRevision: 4,
      imageSessionId: 'session-1',
      nextAdjustmentRevision: 5,
      transactionId: 'tx-1',
    });
  });

  test('patches strict geometry and synchronizes its explicit domain', () => {
    const before = defaultDocument();
    const crop = { height: 0.6, unit: 'normalized' as const, width: 0.6, x: 0.1, y: 0.1 };
    const result = reduceEditTransaction(
      before,
      4,
      request({
        operations: [{ nodeType: 'geometry', patch: { crop, rotation: 2.5 }, type: 'patch-edit-document-node' }],
        source: 'geometry-tool',
      }),
    );

    expect(selectEditDocumentGeometry(result.after)).toMatchObject({ crop, rotation: 2.5 });
    expect(selectEditDocumentNode(result.after, 'geometry').params).toEqual(selectEditDocumentGeometry(result.after));
    expect(result.after.nodes['scene_global_color_tone']).toBe(before.nodes['scene_global_color_tone']);
    expect(result.invalidatedStages).toEqual(['preview', 'navigator', 'thumbnail', 'geometry']);
  });

  test('toggles Effects while preserving latent parameters', () => {
    const before = legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), grainAmount: 42 });
    const result = reduceEditTransaction(
      before,
      4,
      request({
        operations: [{ enabled: false, nodeType: 'display_creative', type: 'set-edit-document-node-enabled' }],
      }),
    );

    expect(selectEditDocumentNode(result.after, 'display_creative')).toMatchObject({
      enabled: false,
      params: { grainAmount: 42 },
    });
    expect(selectEditDocumentNode(result.after, 'display_creative').params).toBe(
      selectEditDocumentNode(before, 'display_creative').params,
    );
    expect(result.changedKeys).toEqual(['nodes.display_creative.enabled']);
  });

  test('toggles every registry-owned Color node in one revision', () => {
    const before = defaultDocument();
    const operations = buildEditorSectionNodeEnablementOperations(before, 'color', false);
    const result = reduceEditTransaction(before, 4, request({ operations }));

    expect(operations).toHaveLength(11);
    expect(result.nextAdjustmentRevision).toBe(5);
    expect(result.changedKeys).toEqual(
      operations.map((operation) =>
        operation.type === 'set-edit-document-node-enabled' ? `nodes.${operation.nodeType}.enabled` : 'unexpected',
      ),
    );
    for (const operation of operations) {
      if (operation.type === 'set-edit-document-node-enabled') {
        expect(result.after.nodes[operation.nodeType]?.enabled).toBeFalse();
      }
    }
    expect(selectEditDocumentNode(result.after, 'scene_global_color_tone').enabled).toBeTrue();
  });

  test('replaces typed authority atomically', () => {
    const before = defaultDocument();
    const replacement = setEditDocumentV2NodeEnabled(before, 'scene_curve', false);
    const result = reduceEditTransaction(
      before,
      4,
      request({ operations: [{ editDocumentV2: replacement, type: 'replace-edit-document' }] }),
    );

    expect(result.changedKeys).toEqual(['nodes.scene_curve.enabled']);
    expect(result.after).toBe(replacement);
    expect(result.after).toEqual(replacement);
    expect(selectEditDocumentNode(result.after, 'scene_curve').enabled).toBeFalse();
  });

  test('replaces one typed node without mutating unrelated authority', () => {
    const before = defaultDocument();
    const sourceNode = {
      ...selectEditDocumentNode(before, 'scene_global_color_tone'),
      params: { ...selectEditDocumentNode(before, 'scene_global_color_tone').params, exposure: 1.25 },
    };
    const result = reduceEditTransaction(
      before,
      4,
      request({
        operations: [{ node: sourceNode, nodeType: 'scene_global_color_tone', type: 'replace-edit-document-node' }],
        source: 'copy-paste',
      }),
    );

    expect(selectEditDocumentNode(result.after, 'scene_global_color_tone').params.exposure).toBe(1.25);
    expect(result.after.provenance.referenceMatchApplicationReceipt).toBeNull();
    expect(result.after.nodes['geometry']).toBe(before.nodes['geometry']);
  });

  test('patches explicit editor-only dust settings without claiming render-node ownership', () => {
    const before = defaultDocument();
    const result = reduceEditTransaction(
      before,
      4,
      request({
        operations: [
          {
            patch: { dustSpotMinRadiusPx: 4, dustSpotOverlayEnabled: true, dustSpotSensitivity: 72 },
            type: 'patch-dust-spot-editor-settings',
          },
        ],
      }),
    );

    expect(result.after.extensions['legacyAdjustments']).toMatchObject({
      dustSpotMinRadiusPx: 4,
      dustSpotOverlayEnabled: true,
      dustSpotSensitivity: 72,
    });
    expect(result.changedKeys).toEqual(['extensions']);
  });

  test('exact no-ops preserve document identity and revision', () => {
    const before = defaultDocument();
    const result = reduceEditTransaction(
      before,
      4,
      request({
        operations: [
          {
            nodeType: 'scene_global_color_tone',
            patch: { exposure: INITIAL_ADJUSTMENTS.exposure },
            type: 'patch-edit-document-node',
          },
        ],
      }),
    );

    expect(result.noOp).toBeTrue();
    expect(result.changedKeys).toEqual([]);
    expect(result.nextAdjustmentRevision).toBe(4);
    expect(result.after).toBe(before);
  });

  test('rejects stale revisions, stale sessions, and empty transactions', () => {
    const before = defaultDocument();
    expect(() => reduceEditTransaction(before, 5, request())).toThrow('edit_transaction.stale_base:4:5');
    expect(() => reduceEditTransaction(before, 4, request(), 'session-2')).toThrow(
      'edit_transaction.stale_session:session-1:session-2',
    );
    expect(() => reduceEditTransaction(before, 4, request({ operations: [] }))).toThrow(
      'edit_transaction.empty_operations',
    );
  });

  test('schema validation rejects invalid typed parameter values', () => {
    const before = defaultDocument();
    expect(() =>
      reduceEditTransaction(
        before,
        4,
        request({
          operations: [
            {
              nodeType: 'scene_global_color_tone',
              patch: { exposure: Number.NaN },
              type: 'patch-edit-document-node',
            },
          ],
        }),
      ),
    ).toThrow();
  });
});

describe('typed transaction store integration', () => {
  test('publishes one immutable render snapshot and history boundary', () => {
    const result = useEditorStore
      .getState()
      .applyEditTransaction(request({ baseAdjustmentRevision: 0, imageSessionId: 'editor-image-session:1' }));
    const state = useEditorStore.getState();

    expect(result.after).toBe(state.editDocumentV2);
    expect(state.adjustmentSnapshot.editDocumentV2).toBe(state.editDocumentV2);
    expect(selectEditDocumentNode(state.editDocumentV2, 'scene_global_color_tone').params.exposure).toBe(0.5);
    expect(state.adjustmentRevision).toBe(1);
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
  });

  test('layer transactions publish typed layers and persistence identity', () => {
    const next = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      masks: [
        {
          adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
          editNodeSchemaVersion: 1 as const,
          editNodes: createDefaultMaskEditNodes(),
          id: 'layer-persisted',
          invert: false,
          name: 'Layer persisted',
          opacity: 100,
          subMasks: [],
          visible: true,
        },
      ],
    };
    const state = {
      adjustmentRevision: 7,
      adjustmentSnapshot: { value: INITIAL_ADJUSTMENTS },
      editDocumentV2: defaultDocument(),
      imageSession: { id: 'session-layer' },
      imageSessionId: 4,
    };
    const transaction = buildLayerEditTransactionRequest(state, next, 'layer-persist-1');
    const result = reduceEditTransaction(state.editDocumentV2, 7, transaction, 'session-layer');

    expect(transaction.operations).toHaveLength(1);
    expect(transaction.operations[0]).toMatchObject({ nodeType: 'layers', type: 'patch-edit-document-node' });
    expect(selectEditDocumentLayers(result.after).masks.map(({ id }) => id)).toEqual(['layer-persisted']);
    expect(selectEditDocumentNode(result.after, 'layers').params).toEqual(selectEditDocumentLayers(result.after));
    expect(buildEditTransactionPersistenceContext(transaction, result)).toEqual({
      baseAdjustmentRevision: 7,
      imageSessionId: 'session-layer',
      nextAdjustmentRevision: 8,
      transactionId: 'layer-persist-1',
    });
  });

  test('reset replaces history atomically', () => {
    const state = useEditorStore.getState();
    state.applyEditTransaction(request({ baseAdjustmentRevision: 0, imageSessionId: 'editor-image-session:1' }));
    const resetDocument = defaultDocument();
    const reset = useEditorStore.getState().applyEditTransaction(
      request({
        baseAdjustmentRevision: 1,
        history: 'reset',
        imageSessionId: 'editor-image-session:1',
        operations: [{ editDocumentV2: resetDocument, type: 'replace-edit-document' }],
        source: 'reset',
      }),
    );
    const after = useEditorStore.getState();

    expect(reset.source).toBe('reset');
    expect(reset.changedKeys).toEqual(['nodes.scene_global_color_tone.params.exposure']);
    expect(after.editDocumentV2).toEqual(resetDocument);
    expect(after.adjustmentRevision).toBe(2);
    expect(after.history).toEqual([resetDocument]);
    expect(after.historyIndex).toBe(0);
    expect(after.historyCheckpoints).toEqual([]);
  });
});
