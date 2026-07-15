import { beforeEach, describe, expect, test } from 'bun:test';
import type { ViewerInitialMaskDrawSessionKey } from '../../../src/components/panel/editor/viewerInitialMaskDrawInteractionController';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { buildInitialMaskDrawEditTransaction } from '../../../src/utils/initialMaskDrawEditTransaction';

const sourcePath = '/fixture/initial-mask-target.ARW';
const sourceRevision = 'viewer-graph:mask:1';
const geometryEpoch = 11;
const session = createEditorImageSession({ generation: 8, path: sourcePath, source: 'cache' });
const radialId = 'radial:1';
const identity = (overrides: Partial<ViewerInitialMaskDrawSessionKey> = {}): ViewerInitialMaskDrawSessionKey => ({
  active: true,
  geometryEpoch,
  imageSessionId: session.id,
  maskId: radialId,
  operationGeneration: 1,
  sourceIdentity: sourcePath,
  sourceRevision,
  tool: 'radial',
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

describe('initial mask draw edit transaction', () => {
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
          name: 'Radial layer',
          opacity: 100,
          subMasks: [
            {
              id: radialId,
              invert: false,
              mode: SubMaskMode.Additive,
              opacity: 100,
              parameters: { feather: 0.5, isInitialDraw: true },
              type: Mask.Radial,
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
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      history: [adjustments],
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
    });
  });

  test('commits one source-bound mask revision with persistence and Undo', () => {
    const parameters = { centerX: 800, centerY: 600, feather: 0.5, radiusX: 220, radiusY: 160, rotation: 0 };
    const request = buildInitialMaskDrawEditTransaction(
      { ...useEditorStore.getState(), geometryEpoch, sourceRevision },
      identity(),
      parameters,
      'initial-mask-commit',
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
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.masks[0]?.subMasks[0]?.parameters).toEqual({
      feather: 0.5,
      isInitialDraw: true,
    });
    expect(useEditorStore.getState().adjustments.exposure).toBe(0.4);
  });

  test('rejects stale session, source, graph, geometry, and tool identities', () => {
    const state = { ...useEditorStore.getState(), geometryEpoch, sourceRevision };
    const parameters = { centerX: 1, centerY: 2, radiusX: 3, radiusY: 4, rotation: 0 };
    expect(() =>
      buildInitialMaskDrawEditTransaction(state, identity({ imageSessionId: 'successor' }), parameters, 'tx'),
    ).toThrow('initial_mask_transaction.stale_session');
    expect(() =>
      buildInitialMaskDrawEditTransaction(state, identity({ sourceIdentity: '/other.ARW' }), parameters, 'tx'),
    ).toThrow('initial_mask_transaction.stale_source');
    expect(() =>
      buildInitialMaskDrawEditTransaction(state, identity({ sourceRevision: 'graph:other' }), parameters, 'tx'),
    ).toThrow('initial_mask_transaction.stale_graph');
    expect(() => buildInitialMaskDrawEditTransaction(state, identity({ geometryEpoch: 12 }), parameters, 'tx')).toThrow(
      'initial_mask_transaction.stale_geometry',
    );
    expect(() => buildInitialMaskDrawEditTransaction(state, identity({ tool: 'linear' }), parameters, 'tx')).toThrow(
      'initial_mask_transaction.tool_mismatch',
    );
  });
});
