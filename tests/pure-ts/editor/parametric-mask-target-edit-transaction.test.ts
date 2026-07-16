import { beforeEach, describe, expect, test } from 'bun:test';
import type { ViewerParametricMaskTargetKey } from '../../../src/components/panel/editor/viewerParametricMaskTargetInteractionController';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { buildParametricMaskTargetEditTransaction } from '../../../src/utils/parametricMaskTargetEditTransaction';

const sourcePath = '/fixture/parametric-mask-target.ARW';
const sourceRevision = 'viewer-graph:parametric:1';
const geometryEpoch = 11;
const session = createEditorImageSession({ generation: 8, path: sourcePath, source: 'cache' });
const colorId = 'color:1';
const identity = (overrides: Partial<ViewerParametricMaskTargetKey> = {}): ViewerParametricMaskTargetKey => ({
  active: true,
  geometryEpoch,
  imageSessionId: session.id,
  maskId: colorId,
  operationGeneration: 1,
  pointerId: 1,
  pointerType: 'mouse',
  sourceIdentity: sourcePath,
  sourceRevision,
  tool: 'color',
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

describe('parametric mask target edit transaction', () => {
  beforeEach(() => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      exposure: 0.4,
      masks: [
        {
          adjustments: {},
          blendMode: 'normal' as const,
          id: 'layer:1',
          invert: false,
          name: 'Color layer',
          opacity: 100,
          subMasks: [
            {
              id: colorId,
              invert: false,
              mode: SubMaskMode.Additive,
              opacity: 100,
              parameters: { isInitialDraw: true, range: 0.2 },
              type: Mask.Color,
              visible: true,
            },
          ],
          visible: true,
        },
      ],
    };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
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

  test('commits one source-bound mask revision with persistence and Undo', () => {
    const parameters = { range: 0.2, rotation: 0, targetX: 800, targetY: 600 };
    const request = buildParametricMaskTargetEditTransaction(
      { ...useEditorStore.getState(), geometryEpoch, sourceRevision },
      identity(),
      parameters,
      'parametric-mask-target:commit',
    );
    const result = useEditorStore.getState().applyEditTransaction(request);

    expect(result).toMatchObject({
      changedKeys: ['masks'],
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'layer-command',
    });
    expect(result.after.masks[0]?.subMasks[0]?.parameters).toEqual(parameters);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'layer-command',
      transactionId: 'parametric-mask-target:commit',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.masks[0]?.subMasks[0]?.parameters).toEqual({
      isInitialDraw: true,
      range: 0.2,
    });
    expect(useEditorStore.getState().adjustmentSnapshot.value.exposure).toBe(0.4);
  });

  test('rejects stale session, source, graph, geometry, tool, and mask identities', () => {
    const state = { ...useEditorStore.getState(), geometryEpoch, sourceRevision };
    const parameters = { targetX: 1, targetY: 2 };
    expect(() =>
      buildParametricMaskTargetEditTransaction(state, identity({ active: false }), parameters, 'tx'),
    ).toThrow('parametric_mask_target.inactive');
    expect(() =>
      buildParametricMaskTargetEditTransaction(state, identity({ imageSessionId: 'successor' }), parameters, 'tx'),
    ).toThrow('parametric_mask_target.stale_image_session');
    expect(() =>
      buildParametricMaskTargetEditTransaction(state, identity({ sourceIdentity: '/other.ARW' }), parameters, 'tx'),
    ).toThrow('parametric_mask_target.stale_source');
    expect(() =>
      buildParametricMaskTargetEditTransaction(state, identity({ sourceRevision: 'graph:other' }), parameters, 'tx'),
    ).toThrow('parametric_mask_target.stale_source_revision');
    expect(() =>
      buildParametricMaskTargetEditTransaction(state, identity({ geometryEpoch: 12 }), parameters, 'tx'),
    ).toThrow('parametric_mask_target.stale_geometry');
    expect(() =>
      buildParametricMaskTargetEditTransaction(state, identity({ tool: 'luminance' }), parameters, 'tx'),
    ).toThrow('parametric_mask_target.stale_tool');
    expect(() =>
      buildParametricMaskTargetEditTransaction(state, identity({ maskId: 'missing' }), parameters, 'tx'),
    ).toThrow('parametric_mask_target.missing_mask');
  });
});
