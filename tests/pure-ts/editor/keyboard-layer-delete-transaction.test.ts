import { beforeEach, describe, expect, test } from 'bun:test';

import { readLayerStackSidecarsFromSidecar } from '../../../packages/rawengine-schema/src';
import { editDocumentLayersV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { useEditorStore } from '../../../src/store/useEditorStore';
import {
  createDefaultMaskEditNodes,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import { buildKeyboardLayerDeleteTransaction } from '../../../src/utils/layers/keyboardLayerDeleteTransaction';
import { buildLayerStackSidecarFromMasks } from '../../../src/utils/layers/layerStackCommandBridge';
import { persistLayerStackSidecarInEditDocumentCandidate } from '../../../src/utils/layers/layerStackSidecarAdjustments';

const imagePath = '/fixtures/keyboard-layer-delete.ARW';
const layer: MaskContainer = {
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  blendMode: 'normal',
  editNodes: createDefaultMaskEditNodes(),
  editNodeSchemaVersion: 1,
  id: 'keyboard-delete-layer',
  invert: false,
  name: 'Keyboard delete layer',
  opacity: 100,
  subMasks: [],
  visible: true,
};

const seedStore = () => {
  const baseDocument = createDefaultEditDocumentV2();
  const sidecar = buildLayerStackSidecarFromMasks([layer], {
    graphRevision: 'keyboard_delete_initial',
    imagePath,
    operationId: 'keyboard-delete-seed',
    sessionId: 'keyboard-delete-test',
  });
  const candidate = persistLayerStackSidecarInEditDocumentCandidate(baseDocument, [layer], sidecar);
  const layers = editDocumentLayersV2Schema.parse({ masks: candidate.masks });
  const patchedDocument = patchEditDocumentV2Node(baseDocument, 'layers', layers);
  const editDocumentV2 = {
    ...patchedDocument,
    extensions: { ...patchedDocument.extensions, rawEngineArtifacts: candidate.rawEngineArtifacts },
  };
  useEditorStore.getState().hydrateEditorRenderAuthority({
    activeMaskContainerId: layer.id,
    activeMaskId: null,
    adjustmentRevision: 0,
    finalPreviewUrl: 'blob:layer-current',
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 31,
    lastEditApplicationReceipt: null,
    navigatorPreviewArtifact: {
      graphIdentity: 'keyboard-delete-before',
      id: 'navigator-before',
      imageSessionId: 'editor-image-session:31',
      url: 'blob:navigator-before',
    },
    selectedImage: {
      exif: null,
      height: 1200,
      isRaw: true,
      isReady: true,
      metadata: null,
      originalUrl: null,
      path: imagePath,
      rawDevelopmentReport: null,
      thumbnailUrl: '',
      width: 1800,
    },
    transformedOriginalUrl: 'blob:original-before',
    editDocumentV2,
    history: [editDocumentV2],
  });
};

beforeEach(seedStore);

describe('keyboard layer delete EditTransaction boundary', () => {
  test('deletes the selected layer and its sidecar in one revision, history, and provenance boundary', () => {
    const state = useEditorStore.getState();
    const prepared = buildKeyboardLayerDeleteTransaction(state, layer.id, 'keyboard-delete-commit');
    expect(prepared).not.toBeNull();
    if (prepared === null) return;

    const result = state.applyEditTransaction(prepared.request);
    const committed = useEditorStore.getState();

    expect(result).toMatchObject({
      imageSessionId: 'editor-image-session:31',
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'layer-command',
      transactionId: 'keyboard-delete-commit',
    });
    expect(result.invalidatedStages).toEqual(['preview', 'navigator', 'thumbnail']);
    expect(committed.editDocumentV2.layers.masks).toEqual([]);
    expect(readLayerStackSidecarsFromSidecar(committed.editDocumentV2.extensions)).toMatchObject([
      { graphRevision: expect.stringContaining('keyboard-delete-commit'), layers: [], sourceImagePath: imagePath },
    ]);
    expect(committed.adjustmentRevision).toBe(1);
    expect(committed.history).toHaveLength(2);
    expect(committed.historyIndex).toBe(1);
    expect(committed.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      baseAdjustmentRevision: 0,
      persistence: 'commit',
      transactionId: 'keyboard-delete-commit',
    });
    expect(committed.finalPreviewUrl).toBeNull();
    expect(committed.navigatorPreviewArtifact).toBeNull();
    expect(committed.transformedOriginalUrl).toBeNull();

    committed.undo();
    expect(useEditorStore.getState().editDocumentV2.layers.masks.map((mask) => mask.id)).toEqual([layer.id]);
    committed.redo();
    expect(useEditorStore.getState().editDocumentV2.layers.masks).toEqual([]);
  });

  test('a missing selected layer is an exact render no-op', () => {
    const before = useEditorStore.getState();
    const prepared = buildKeyboardLayerDeleteTransaction(before, 'missing-layer', 'keyboard-delete-no-op');
    const after = useEditorStore.getState();

    expect(prepared).toBeNull();
    expect(after.adjustmentRevision).toBe(before.adjustmentRevision);
    expect(after.history).toEqual(before.history);
    expect(after.lastEditApplicationReceipt).toBe(before.lastEditApplicationReceipt);
    expect(after.finalPreviewUrl).toBe('blob:layer-current');
  });

  test('rejects a stale delete without removing the layer or its source artifact', () => {
    const base = useEditorStore.getState();
    const prepared = buildKeyboardLayerDeleteTransaction(base, layer.id, 'keyboard-delete-stale');
    expect(prepared).not.toBeNull();
    if (prepared === null) return;

    base.applyEditTransaction({
      baseAdjustmentRevision: 0,
      history: 'single-entry',
      imageSessionId: 'editor-image-session:31',
      operations: [{ nodeType: 'scene_global_color_tone', patch: { exposure: 0.5 }, type: 'patch-edit-document-node' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'newer-edit',
    });

    expect(() => useEditorStore.getState().applyEditTransaction(prepared.request)).toThrow(
      'edit_transaction.stale_base:0:1',
    );
    const committed = useEditorStore.getState();
    expect(committed.editDocumentV2.layers.masks.map((mask) => mask.id)).toEqual([layer.id]);
    expect(
      readLayerStackSidecarsFromSidecar(committed.editDocumentV2.extensions)[0]?.layers.map((item) => item.id),
    ).toEqual([layer.id]);
  });
});
