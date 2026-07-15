import { beforeEach, describe, expect, test } from 'bun:test';
import type { ViewerObjectPromptKey } from '../../../src/components/panel/editor/viewerObjectPromptInteractionController';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { buildObjectPromptEditTransaction } from '../../../src/utils/objectPromptEditTransaction';

const sourcePath = '/fixture/object-prompt.ARW';
const sourceRevision = 'viewer-graph:object:1';
const geometryEpoch = 11;
const session = createEditorImageSession({ generation: 8, path: sourcePath, source: 'cache' });
const maskId = 'object:1';
const identity = (overrides: Partial<ViewerObjectPromptKey> = {}): ViewerObjectPromptKey => ({
  active: true,
  geometryEpoch,
  imageSessionId: session.id,
  maskId,
  mode: 'foreground_point',
  operationGeneration: 1,
  sourceIdentity: sourcePath,
  sourceRevision,
  tool: 'object-prompt',
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

describe('Object Prompt edit transaction', () => {
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
          name: 'Object layer',
          opacity: 100,
          subMasks: [
            {
              id: maskId,
              invert: false,
              mode: SubMaskMode.Additive,
              opacity: 100,
              parameters: { promptMode: 'foreground_point', pointPrompts: [] },
              type: Mask.AiObject,
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

  test('commits one source-bound prompt revision with persistence and Undo', () => {
    const parameters = {
      boxPrompt: null,
      pendingBoxAnchor: null,
      pointPrompts: [{ label: 'foreground' as const, x: 0.25, y: 0.4 }],
      promptMode: 'foreground_point',
    };
    const request = buildObjectPromptEditTransaction(
      { ...useEditorStore.getState(), geometryEpoch, sourceRevision },
      identity(),
      parameters,
      'object-prompt:commit',
    );
    const result = useEditorStore.getState().applyEditTransaction(request);

    expect(result).toMatchObject({ changedKeys: ['masks'], nextAdjustmentRevision: 1, noOp: false });
    expect(result.after.masks[0]?.subMasks[0]?.parameters).toEqual(parameters);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      persistence: 'commit',
      source: 'layer-command',
      transactionId: 'object-prompt:commit',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.masks[0]?.subMasks[0]?.parameters).toEqual({
      pointPrompts: [],
      promptMode: 'foreground_point',
    });
    expect(useEditorStore.getState().adjustments.exposure).toBe(0.4);
  });

  test('rejects stale session, source, graph, geometry, mode, tool, and mask identities', () => {
    const state = { ...useEditorStore.getState(), geometryEpoch, sourceRevision };
    const parameters = { pointPrompts: [], promptMode: 'foreground_point' };
    expect(() => buildObjectPromptEditTransaction(state, identity({ active: false }), parameters, 'tx')).toThrow(
      'object_prompt_transaction.invalid_generation',
    );
    expect(() =>
      buildObjectPromptEditTransaction(state, identity({ imageSessionId: 'successor' }), parameters, 'tx'),
    ).toThrow('object_prompt_transaction.stale_image_session');
    expect(() =>
      buildObjectPromptEditTransaction(state, identity({ sourceIdentity: '/other.ARW' }), parameters, 'tx'),
    ).toThrow('object_prompt_transaction.stale_source');
    expect(() =>
      buildObjectPromptEditTransaction(state, identity({ sourceRevision: 'graph:other' }), parameters, 'tx'),
    ).toThrow('object_prompt_transaction.stale_source_revision');
    expect(() => buildObjectPromptEditTransaction(state, identity({ geometryEpoch: 12 }), parameters, 'tx')).toThrow(
      'object_prompt_transaction.stale_geometry',
    );
    expect(() => buildObjectPromptEditTransaction(state, identity({ mode: 'box' }), parameters, 'tx')).toThrow(
      'object_prompt_transaction.stale_mode',
    );
    const wrongTool = { ...state, adjustments: structuredClone(state.adjustments) };
    const subMask = wrongTool.adjustments.masks[0]?.subMasks[0];
    if (subMask !== undefined) subMask.type = Mask.Color;
    expect(() => buildObjectPromptEditTransaction(wrongTool, identity(), parameters, 'tx')).toThrow(
      'object_prompt_transaction.stale_tool',
    );
    expect(() =>
      buildObjectPromptEditTransaction(state, identity({ tool: 'object-prompt', maskId: 'missing' }), parameters, 'tx'),
    ).toThrow('object_prompt_transaction.missing_mask');
  });
});
