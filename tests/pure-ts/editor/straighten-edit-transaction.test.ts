import { beforeEach, describe, expect, test } from 'bun:test';
import { editDocumentGeometryV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import type { CropStraightenSessionIdentity } from '../../../src/components/panel/editor/cropStraightenController';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { hydrateImageOpenEditDocumentV2 } from '../../../src/utils/imageOpenAdjustmentHydration';
import { buildStraightenEditTransaction } from '../../../src/utils/straightenEditTransaction';

const sourcePath = '/fixture/straighten.ARW';
const sourceRevision = 'viewer-graph:straighten:1';
const operationGeneration = 11;
const session = createEditorImageSession({ generation: 11, path: sourcePath, source: 'cache' });
const identity = (overrides: Partial<CropStraightenSessionIdentity> = {}): CropStraightenSessionIdentity => ({
  geometryEpoch: 5,
  imageSessionId: session.id,
  operationGeneration,
  sourceIdentity: sourcePath,
  sourceRevision,
  tool: 'straighten',
  ...overrides,
});
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

const transactionState = () => ({
  ...useEditorStore.getState(),
  operationGeneration,
  sourceRevision,
});

describe('straighten edit transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
      editDocumentV2: publishAdjustmentSnapshot(null, adjustments).editDocumentV2,
      history: [publishAdjustmentSnapshot(null, adjustments).editDocumentV2],
    });
  });

  test('commits one source-typed geometry revision with history, persistence, and undo', () => {
    const state = useEditorStore.getState();
    const beforeGeometry = state.editDocumentV2.nodes['geometry'];
    const beforeTone = state.editDocumentV2.nodes['scene_global_color_tone'];
    const request = buildStraightenEditTransaction(transactionState(), identity(), -5.5, 'straighten-commit');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      {
        nodeType: 'geometry',
        patch: {
          crop: expect.objectContaining({ height: expect.any(Number), width: expect.any(Number) }),
          rotation: -5.5,
        },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(result).toMatchObject({
      changedKeys: expect.arrayContaining(['crop', 'rotation']),
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'geometry-tool',
    });
    expect(result.invalidatedStages).toContain('geometry');
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().adjustmentSnapshot.value.rotation).toBe(-5.5);
    const geometry = editDocumentGeometryV2Schema.parse(result.afterEditDocumentV2.nodes['geometry']?.params);
    expect(result.afterEditDocumentV2.nodes['geometry']).not.toBe(beforeGeometry);
    expect(geometry).toMatchObject({
      crop: { ...result.after.crop, unit: 'px' },
      rotation: -5.5,
    });
    expect(result.afterEditDocumentV2.nodes['scene_global_color_tone']).toBe(beforeTone);
    expect(result.afterEditDocumentV2.extensions['legacyAdjustments']).not.toHaveProperty('crop');
    expect(result.afterEditDocumentV2.extensions['legacyAdjustments']).not.toHaveProperty('rotation');
    const reopened = hydrateImageOpenEditDocumentV2(
      {
        adjustments: structuredClone(result.after),
        editDocumentV2: structuredClone(result.afterEditDocumentV2),
      },
      structuredClone(result.after),
    );
    expect(editDocumentGeometryV2Schema.parse(reopened.nodes['geometry']?.params)).toEqual(geometry);
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('rotation');
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      baseAdjustmentRevision: 0,
      persistence: 'commit',
      source: 'geometry-tool',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.rotation).toBe(0);
    expect(
      editDocumentGeometryV2Schema.parse(useEditorStore.getState().editDocumentV2.nodes['geometry']?.params).rotation,
    ).toBe(0);
    expect(useEditorStore.getState().historyIndex).toBe(0);
    useEditorStore.getState().redo();
    expect(
      editDocumentGeometryV2Schema.parse(useEditorStore.getState().editDocumentV2.nodes['geometry']?.params).rotation,
    ).toBe(-5.5);
  });

  test('preserves exact no-ops and rejects stale source, session, graph, generation, tool, and revision', () => {
    const state = useEditorStore.getState();
    const noOp = state.applyEditTransaction(
      buildStraightenEditTransaction(transactionState(), identity(), 0, 'straighten-no-op'),
    );
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();

    const staleCases: Array<[CropStraightenSessionIdentity, string]> = [
      [identity({ sourceIdentity: '/fixture/stale.ARW' }), 'straighten_transaction.stale_source'],
      [identity({ imageSessionId: 'editor-image-session:stale' }), 'straighten_transaction.stale_session'],
      [identity({ sourceRevision: 'viewer-graph:stale' }), 'straighten_transaction.stale_graph'],
      [identity({ operationGeneration: operationGeneration - 1 }), 'straighten_transaction.stale_generation'],
      [identity({ tool: 'crop' }), 'straighten_transaction.invalid_tool'],
    ];
    for (const [staleIdentity, expectedError] of staleCases) {
      expect(() => buildStraightenEditTransaction(transactionState(), staleIdentity, 2, 'straighten-stale')).toThrow(
        expectedError,
      );
    }

    const staleRevision = buildStraightenEditTransaction(
      transactionState(),
      identity(),
      3,
      'straighten-stale-revision',
    );
    state.applyEditTransaction({
      baseAdjustmentRevision: 0,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [{ patch: { exposure: 0.25 }, type: 'patch-adjustments' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'newer-edit',
    });
    expect(() => useEditorStore.getState().applyEditTransaction(staleRevision)).toThrow(
      'edit_transaction.stale_base:0:1',
    );
  });

  test('keeps legacy unitless pixel crops inert while the node document remains unit-explicit', () => {
    const legacyCrop = { height: 1800, width: 2400, x: 400, y: 300 };
    useEditorStore.getState().hydrateEditorRenderAuthority((state) => {
      const adjustments = { ...state.adjustmentSnapshot.value, crop: legacyCrop };
      const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
      return {
        adjustmentRevision: 0,
        editDocumentV2,
        history: [editDocumentV2],
        historyIndex: 0,
      };
    });

    const state = useEditorStore.getState();
    expect(editDocumentGeometryV2Schema.parse(state.editDocumentV2.nodes['geometry']?.params).crop).toEqual({
      ...legacyCrop,
      unit: 'px',
    });
    const result = state.applyEditTransaction(
      buildStraightenEditTransaction(transactionState(), identity(), 0, 'straighten-legacy-crop-no-op'),
    );
    expect(result.noOp).toBeTrue();
    expect(result.nextAdjustmentRevision).toBe(0);
    expect(useEditorStore.getState().adjustmentSnapshot.value.crop).toEqual({ ...legacyCrop, unit: 'px' });
    expect(
      editDocumentGeometryV2Schema.parse(useEditorStore.getState().editDocumentV2.nodes['geometry']?.params).crop,
    ).toEqual({ ...legacyCrop, unit: 'px' });
  });
});
