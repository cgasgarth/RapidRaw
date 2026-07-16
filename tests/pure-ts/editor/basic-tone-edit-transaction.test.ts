import { beforeEach, describe, expect, test } from 'bun:test';

import {
  editDocumentColorPresenceV2Schema,
  sceneGlobalColorToneParamsV2Schema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { BasicAdjustment, ColorAdjustment } from '../../../src/utils/adjustments';
import {
  type BasicToneCommitIdentity,
  buildBasicToneEditTransaction,
  captureBasicToneCommitIdentity,
} from '../../../src/utils/basicToneEditTransaction';
import { createDefaultEditDocumentV2, updateEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import { buildAdjustmentMutationOperations } from '../../../src/utils/editTransaction';
import { hydrateImageOpenEditDocumentV2 } from '../../../src/utils/imageOpenAdjustmentHydration';

const sourcePath = '/fixture/basic-tone.ARW';
const session = createEditorImageSession({ generation: 12, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<BasicToneCommitIdentity> = {}): BasicToneCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('basic tone edit transaction', () => {
  beforeEach(() => {
    const editDocumentV2 = updateEditDocumentV2Node(createDefaultEditDocumentV2(), 'geometry', (geometry) => ({
      ...geometry,
      flipHorizontal: true,
    }));
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
      history: [editDocumentV2],
    });
  });

  test('commits one scene-global exposure revision while preserving geometry and Undo', () => {
    const state = useEditorStore.getState();
    const request = buildBasicToneEditTransaction(state, identity(), BasicAdjustment.Exposure, 0.65, 'basic-exposure');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      { nodeType: 'scene_global_color_tone', patch: { exposure: 0.65 }, type: 'patch-edit-document-node' },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['exposure'],
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'manual-control',
    });
    expect(result.afterEditDocumentV2.nodes['geometry']).toEqual(result.beforeEditDocumentV2.nodes['geometry']);
    expect(
      sceneGlobalColorToneParamsV2Schema.parse(result.afterEditDocumentV2.nodes['scene_global_color_tone']?.params)
        .exposure,
    ).toBe(0.65);
    expect(result.invalidatedStages).not.toContain('geometry');
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'manual-control',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.exposure).toBe(0);
    expect(useEditorStore.getState().adjustmentSnapshot.value.flipHorizontal).toBe(true);
  });

  test('supports every Basic field, exact no-ops, and stale source/session/revision rejection', () => {
    const state = useEditorStore.getState();
    const fields = Object.values(BasicAdjustment);
    for (const field of fields) {
      expect(buildBasicToneEditTransaction(state, identity(), field, 0, `basic-${field}`).operations).toEqual([
        { nodeType: 'scene_global_color_tone', patch: { [field]: 0 }, type: 'patch-edit-document-node' },
      ]);
    }

    const noOp = state.applyEditTransaction(
      buildBasicToneEditTransaction(state, identity(), BasicAdjustment.Exposure, 0, 'basic-no-op'),
    );
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();

    expect(() =>
      buildBasicToneEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        BasicAdjustment.Exposure,
        1,
        'stale-source',
      ),
    ).toThrow('basic_tone_transaction.stale_source');
    expect(() =>
      buildBasicToneEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        BasicAdjustment.Exposure,
        1,
        'stale-session',
      ),
    ).toThrow('basic_tone_transaction.stale_session');
    expect(() =>
      buildBasicToneEditTransaction(
        state,
        identity({ adjustmentRevision: 1 }),
        BasicAdjustment.Exposure,
        1,
        'stale-revision',
      ),
    ).toThrow('basic_tone_transaction.stale_revision');
  });

  test('commits Color Presence as one persistent node across reopen and Undo/Redo', () => {
    const state = useEditorStore.getState();
    const beforeGeometry = state.editDocumentV2.nodes['geometry'];
    const next = { ...state.adjustmentSnapshot.value, hue: 32, vibrance: 44 };
    const operations = buildAdjustmentMutationOperations(state.adjustmentSnapshot.value, next);
    expect(operations).toEqual([
      {
        nodeType: 'color_presence',
        patch: { [ColorAdjustment.Hue]: 32, [ColorAdjustment.Vibrance]: 44 },
        type: 'patch-edit-document-node',
      },
    ]);

    const result = state.applyEditTransaction({
      baseAdjustmentRevision: 0,
      history: 'single-entry',
      imageSessionId: session.id,
      operations,
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'color-presence',
    });
    expect(
      editDocumentColorPresenceV2Schema.parse(result.afterEditDocumentV2.nodes['color_presence']?.params),
    ).toMatchObject({
      hue: 32,
      saturation: 0,
      vibrance: 44,
    });
    expect(result.afterEditDocumentV2.nodes['geometry']).toBe(beforeGeometry);
    expect(result.afterEditDocumentV2.extensions).toEqual({});
    const reopened = hydrateImageOpenEditDocumentV2(
      { adjustments: structuredClone(result.after), editDocumentV2: structuredClone(result.afterEditDocumentV2) },
      structuredClone(result.after),
    );
    expect(editDocumentColorPresenceV2Schema.parse(reopened.nodes['color_presence']?.params)).toMatchObject({
      hue: 32,
      saturation: 0,
      vibrance: 44,
    });
    expect(result.applicationReceipt).toMatchObject({ adjustmentRevision: 1, persistence: 'commit' });

    useEditorStore.getState().undo();
    expect(
      editDocumentColorPresenceV2Schema.parse(useEditorStore.getState().editDocumentV2.nodes['color_presence']?.params),
    ).toMatchObject({
      hue: 0,
      saturation: 0,
      vibrance: 0,
    });
    useEditorStore.getState().redo();
    expect(
      editDocumentColorPresenceV2Schema.parse(useEditorStore.getState().editDocumentV2.nodes['color_presence']?.params),
    ).toMatchObject({
      hue: 32,
      saturation: 0,
      vibrance: 44,
    });
  });

  test('commits through the canonical fallback session and rejects its successor', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-basic-before',
      imageSession: null,
      imageSessionId: 37,
    });
    const state = useEditorStore.getState();
    const fallbackIdentity: BasicToneCommitIdentity = {
      adjustmentRevision: 0,
      imageSessionId: 'editor-image-session:37',
      sourceIdentity: sourcePath,
    };
    expect(captureBasicToneCommitIdentity(state)).toEqual(fallbackIdentity);

    const noOp = state.applyEditTransaction(
      buildBasicToneEditTransaction(state, fallbackIdentity, BasicAdjustment.Exposure, 0, 'fallback-basic-no-op'),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      finalPreviewUrl: 'blob:fallback-basic-before',
      historyIndex: 0,
      lastEditApplicationReceipt: null,
    });

    const result = state.applyEditTransaction(
      buildBasicToneEditTransaction(state, fallbackIdentity, BasicAdjustment.Exposure, 0.8, 'fallback-basic'),
    );
    expect(result).toMatchObject({ changedKeys: ['exposure'], nextAdjustmentRevision: 1, noOp: false });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: fallbackIdentity.imageSessionId,
        transactionId: 'fallback-basic',
      },
    });
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.exposure).toBe(0);
    expect(() =>
      buildBasicToneEditTransaction(
        { ...state, imageSessionId: 38 },
        fallbackIdentity,
        BasicAdjustment.Exposure,
        1,
        'stale-fallback-basic',
      ),
    ).toThrow('basic_tone_transaction.stale_session');
  });
});
