import { beforeEach, describe, expect, test } from 'bun:test';
import type { ViewerAiMaskBoxSessionKey } from '../../../src/components/panel/editor/viewerAiMaskBoxInteractionController';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { createDefaultMaskEditNodes, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAiMaskBoxEditTransaction } from '../../../src/utils/aiMaskBoxEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/ai-mask-target.ARW';
const sourceRevision = 'viewer-graph:mask:1';
const geometryEpoch = 11;
const session = createEditorImageSession({ generation: 8, path: sourcePath, source: 'cache' });
const subjectId = 'subject:1';
const identity = (overrides: Partial<ViewerAiMaskBoxSessionKey> = {}): ViewerAiMaskBoxSessionKey => ({
  active: true,
  containerFamily: 'masks',
  containerId: 'layer:1',
  geometryEpoch,
  imageSessionId: session.id,
  maskId: subjectId,
  operationGeneration: 1,
  sourceIdentity: sourcePath,
  sourceRevision,
  tool: 'ai-subject',
  ...overrides,
});

describe('AI mask box edit transaction', () => {
  beforeEach(() => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      exposure: 0.4,
      masks: [
        {
          adjustments: {},
          blendMode: 'normal' as const,
          editNodes: createDefaultMaskEditNodes(),
          editNodeSchemaVersion: 1 as const,
          id: 'layer:1',
          invert: false,
          name: 'Subject layer',
          opacity: 100,
          subMasks: [
            {
              id: subjectId,
              invert: false,
              mode: SubMaskMode.Additive,
              opacity: 100,
              parameters: { feather: 0.5 },
              type: Mask.AiSubject,
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
      selectedImage: {
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
      },
      history: [editDocumentV2],
    });
  });

  test('commits one persistent source-bound mask revision with Undo', () => {
    const parameters = { endX: 900, endY: 700, feather: 0.5, startX: 200, startY: 100 };
    const request = buildAiMaskBoxEditTransaction(
      { ...useEditorStore.getState(), geometryEpoch, sourceRevision },
      identity(),
      parameters,
      'ai-mask-box-commit',
    );
    const result = useEditorStore.getState().applyEditTransaction(request);
    expect(result).toMatchObject({ changedKeys: ['masks'], nextAdjustmentRevision: 1, noOp: false });
    expect(result.after.masks[0]?.subMasks[0]?.parameters).toEqual(parameters);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      persistence: 'commit',
      source: 'layer-command',
      transactionId: 'ai-mask-box-commit',
    });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.masks[0]?.subMasks[0]?.parameters).toEqual({
      feather: 0.5,
    });
    expect(useEditorStore.getState().adjustmentSnapshot.value.exposure).toBe(0.4);
  });

  test('targets one Quick Erase submask in the declared AI-patch family', () => {
    const state = useEditorStore.getState();
    const quickEraseId = 'quick-erase:1';
    const adjustments = {
      ...state.adjustmentSnapshot.value,
      masks: [],
      aiPatches: [
        {
          id: 'patch:1',
          invert: false,
          isLoading: false,
          name: 'Quick Erase',
          patchData: null,
          prompt: '',
          subMasks: [
            {
              id: quickEraseId,
              invert: false,
              mode: SubMaskMode.Additive,
              opacity: 100,
              parameters: { feather: 0.2 },
              type: Mask.QuickEraser,
              visible: true,
            },
          ],
          visible: true,
        },
      ],
    };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      editDocumentV2,
      history: [editDocumentV2],
      historyIndex: 0,
    });
    const parameters = { endX: 700, endY: 800, feather: 0.2, startX: 300, startY: 400 };
    const request = buildAiMaskBoxEditTransaction(
      { ...useEditorStore.getState(), geometryEpoch, sourceRevision },
      identity({
        containerFamily: 'aiPatches',
        containerId: 'patch:1',
        maskId: quickEraseId,
        tool: 'quick-eraser',
      }),
      parameters,
      'quick-erase-box-commit',
    );
    const result = useEditorStore.getState().applyEditTransaction(request);
    expect(result.after.aiPatches[0]?.subMasks[0]?.parameters).toEqual(parameters);
    expect(result.after.masks).toEqual([]);
    expect(result).toMatchObject({ noOp: false, source: 'layer-command' });
  });

  test('rejects stale session, source, graph, geometry, tool, and missing-mask identities', () => {
    const state = { ...useEditorStore.getState(), geometryEpoch, sourceRevision };
    const parameters = { endX: 2, endY: 3, startX: 0, startY: 1 };
    expect(() =>
      buildAiMaskBoxEditTransaction(state, identity({ imageSessionId: 'successor' }), parameters, 'tx'),
    ).toThrow('ai_mask_box_transaction.stale_session');
    expect(() =>
      buildAiMaskBoxEditTransaction(state, identity({ sourceIdentity: '/other.ARW' }), parameters, 'tx'),
    ).toThrow('ai_mask_box_transaction.stale_source');
    expect(() =>
      buildAiMaskBoxEditTransaction(state, identity({ sourceRevision: 'graph:other' }), parameters, 'tx'),
    ).toThrow('ai_mask_box_transaction.stale_graph');
    expect(() => buildAiMaskBoxEditTransaction(state, identity({ geometryEpoch: 12 }), parameters, 'tx')).toThrow(
      'ai_mask_box_transaction.stale_geometry',
    );
    expect(() => buildAiMaskBoxEditTransaction(state, identity({ tool: 'quick-eraser' }), parameters, 'tx')).toThrow(
      'ai_mask_box_transaction.stale_tool',
    );
    expect(() => buildAiMaskBoxEditTransaction(state, identity({ maskId: 'missing' }), parameters, 'tx')).toThrow(
      'ai_mask_box_transaction.missing_mask',
    );
  });

  test('rejects duplicate mask identities instead of mutating across families', () => {
    const state = { ...useEditorStore.getState(), geometryEpoch, sourceRevision };
    const parameters = { endX: 2, endY: 3, startX: 0, startY: 1 };
    const duplicatedAdjustments = {
      ...state.adjustmentSnapshot.value,
      masks: state.adjustmentSnapshot.value.masks.map((container) => ({
        ...container,
        subMasks: [...container.subMasks, structuredClone(container.subMasks[0]!)],
      })),
    };
    const duplicatedMaskState = {
      ...state,
      adjustmentSnapshot: { ...state.adjustmentSnapshot, value: duplicatedAdjustments },
    };
    expect(() => buildAiMaskBoxEditTransaction(duplicatedMaskState, identity(), parameters, 'tx')).toThrow(
      'ai_mask_box_transaction.duplicate_mask_in_container',
    );

    const crossFamilyAdjustments = {
      ...state.adjustmentSnapshot.value,
      aiPatches: [
        {
          id: 'patch:1',
          invert: false,
          isLoading: false,
          name: 'Collision',
          patchData: null,
          prompt: '',
          subMasks: [structuredClone(state.adjustmentSnapshot.value.masks[0]!.subMasks[0]!)],
          visible: true,
        },
      ],
    };
    const crossFamilyState = {
      ...state,
      adjustmentSnapshot: { ...state.adjustmentSnapshot, value: crossFamilyAdjustments },
    };
    expect(() => buildAiMaskBoxEditTransaction(crossFamilyState, identity(), parameters, 'tx')).toThrow(
      'ai_mask_box_transaction.cross_family_mask_collision',
    );
  });
});
