import { beforeEach, describe, expect, test } from 'bun:test';

import { editDocumentSceneCurveV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import type { SceneCurveSettingsV1 } from '../../../src/utils/adjustments';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import {
  buildTypedCurveEditTransaction,
  captureTypedCurveCommitIdentity,
  type TypedCurveCommitIdentity,
} from '../../../src/utils/typedCurveEditTransaction';

const sourcePath = '/fixture/typed-curves.ARW';
const session = createEditorImageSession({ generation: 24, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<TypedCurveCommitIdentity> = {}): TypedCurveCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});
const sceneCurve: SceneCurveSettingsV1 = {
  channelMode: 'luminance_preserving',
  middleGrey: 0.18,
  points: [
    { xEv: -16, yEv: -16 },
    { xEv: 0, yEv: 0.7 },
    { xEv: 16, yEv: 16 },
  ],
};

describe('typed curve edit transaction', () => {
  beforeEach(() => {
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      exposure: 0.35,
    });
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

  test('commits a Scene curve node and graph promotion in one persistence and Undo boundary', () => {
    const state = useEditorStore.getState();
    const request = buildTypedCurveEditTransaction(state, identity(), { curve: sceneCurve, domain: 'scene' }, 'scene');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      {
        nodeType: 'scene_curve',
        patch: { sceneCurveV1: sceneCurve },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(result.after).toMatchObject({ exposure: 0.35, rawEngineEditGraphVersion: 2, sceneCurveV1: sceneCurve });
    expect(
      editDocumentSceneCurveV2Schema.parse(result.afterEditDocumentV2.nodes['scene_curve']?.params).sceneCurveV1,
    ).toEqual(sceneCurve);
    expect(result).toMatchObject({ nextAdjustmentRevision: 1, noOp: false });
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'manual-control',
    });

    useEditorStore.getState().undo();
    const undone = useEditorStore.getState().editDocumentV2;
    expect(selectEditDocumentNode(undone, 'scene_global_color_tone').params['exposure']).toBe(0.35);
    expect(selectEditDocumentNode(undone, 'scene_curve').params['sceneCurveV1']).toBeUndefined();
  });

  test('commits an Output curve to the same authoritative node without replacing the Scene domain', () => {
    const editDocumentV2 = patchEditDocumentV2Node(useEditorStore.getState().editDocumentV2, 'scene_curve', {
      sceneCurveV1: sceneCurve,
    });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      editDocumentV2,
      history: [editDocumentV2],
      historyIndex: 0,
    });
    const outputCurve = {
      domain: 'view_encoded' as const,
      peakNits: 406,
      points: [
        { input: 0, output: 0 },
        { input: 1, output: 0.82 },
        { input: 2, output: 2 },
      ],
      sdrReferenceWhiteNits: 203,
      targetIdentity: 'browser-display',
    };

    const state = useEditorStore.getState();
    const result = state.applyEditTransaction(
      buildTypedCurveEditTransaction(state, identity(), { curve: outputCurve, domain: 'output' }, 'output'),
    );

    expect(result.after.sceneCurveV1).toEqual(sceneCurve);
    expect(result.after.outputCurveV1).toEqual(outputCurve);
    expect(editDocumentSceneCurveV2Schema.parse(result.afterEditDocumentV2.nodes['scene_curve']?.params)).toMatchObject(
      {
        outputCurveV1: outputCurve,
        sceneCurveV1: sceneCurve,
      },
    );
    expect(result.changedKeys).toEqual(['outputCurveV1']);
  });

  test('captures identity, rejects stale commits, validates curve shape, and preserves exact no-ops', () => {
    const state = useEditorStore.getState();
    expect(captureTypedCurveCommitIdentity(state)).toEqual(identity());
    expect(() =>
      buildTypedCurveEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/other.ARW' }),
        { curve: sceneCurve, domain: 'scene' },
        'stale-source',
      ),
    ).toThrow('typed_curve_transaction.stale_source');
    expect(() =>
      buildTypedCurveEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        { curve: sceneCurve, domain: 'scene' },
        'stale-session',
      ),
    ).toThrow('typed_curve_transaction.stale_session');
    expect(() =>
      buildTypedCurveEditTransaction(
        state,
        identity({ adjustmentRevision: 1 }),
        { curve: sceneCurve, domain: 'scene' },
        'stale-revision',
      ),
    ).toThrow('typed_curve_transaction.stale_revision');
    expect(() =>
      state.applyEditTransaction(
        buildTypedCurveEditTransaction(
          state,
          identity(),
          { curve: { ...sceneCurve, points: [{ xEv: 0, yEv: 0 }] }, domain: 'scene' },
          'invalid',
        ),
      ),
    ).toThrow();

    const editDocumentV2 = patchEditDocumentV2Node(state.editDocumentV2, 'scene_curve', {
      sceneCurveV1: sceneCurve,
    });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      editDocumentV2,
      history: [editDocumentV2],
      historyIndex: 0,
    });
    const noOpState = useEditorStore.getState();
    const noOp = noOpState.applyEditTransaction(
      buildTypedCurveEditTransaction(noOpState, identity(), { curve: sceneCurve, domain: 'scene' }, 'no-op'),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
  });

  test('commits through the canonical fallback session and rejects its successor', () => {
    const editDocumentV2 = patchEditDocumentV2Node(useEditorStore.getState().editDocumentV2, 'scene_curve', {
      sceneCurveV1: sceneCurve,
    });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      editDocumentV2,
      finalPreviewUrl: 'blob:fallback-curve-before',
      imageSession: null,
      imageSessionId: 41,
      history: [editDocumentV2],
      historyIndex: 0,
    });
    const state = useEditorStore.getState();
    const fallbackIdentity: TypedCurveCommitIdentity = {
      adjustmentRevision: 0,
      imageSessionId: 'editor-image-session:41',
      sourceIdentity: sourcePath,
    };
    expect(captureTypedCurveCommitIdentity(state)).toEqual(fallbackIdentity);

    const noOp = state.applyEditTransaction(
      buildTypedCurveEditTransaction(state, fallbackIdentity, { curve: sceneCurve, domain: 'scene' }, 'fallback-no-op'),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      finalPreviewUrl: 'blob:fallback-curve-before',
      historyIndex: 0,
      lastEditApplicationReceipt: null,
    });

    const nextCurve = { ...sceneCurve, middleGrey: 0.2 };
    const result = state.applyEditTransaction(
      buildTypedCurveEditTransaction(state, fallbackIdentity, { curve: nextCurve, domain: 'scene' }, 'fallback-curve'),
    );
    expect(result).toMatchObject({ changedKeys: ['sceneCurveV1'], nextAdjustmentRevision: 1, noOp: false });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: fallbackIdentity.imageSessionId,
        transactionId: 'fallback-curve',
      },
    });
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'scene_curve').params['sceneCurveV1'],
    ).toEqual(sceneCurve);
    expect(() =>
      buildTypedCurveEditTransaction(
        { ...state, imageSessionId: 42 },
        fallbackIdentity,
        { curve: nextCurve, domain: 'scene' },
        'stale-fallback-curve',
      ),
    ).toThrow('typed_curve_transaction.stale_session');
  });
});
