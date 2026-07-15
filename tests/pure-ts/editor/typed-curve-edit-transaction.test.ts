import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS, type SceneCurveSettingsV1 } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
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
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.35 };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.setState({
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
      { patch: { rawEngineEditGraphVersion: 2 }, type: 'patch-adjustments' },
    ]);
    expect(result.after).toMatchObject({ exposure: 0.35, rawEngineEditGraphVersion: 2, sceneCurveV1: sceneCurve });
    expect(result.afterEditDocumentV2.nodes.scene_curve.params.sceneCurveV1).toEqual(sceneCurve);
    expect(result).toMatchObject({ nextAdjustmentRevision: 1, noOp: false });
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'manual-control',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments).toMatchObject({ exposure: 0.35, rawEngineEditGraphVersion: 1 });
    expect(useEditorStore.getState().adjustments.sceneCurveV1).toBeUndefined();
  });

  test('commits an Output curve to the same authoritative node without replacing the Scene domain', () => {
    const withScene = {
      ...useEditorStore.getState().adjustments,
      rawEngineEditGraphVersion: 2,
      sceneCurveV1: sceneCurve,
    };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(withScene);
    useEditorStore.setState({
      adjustmentSnapshot: publishAdjustmentSnapshot(null, withScene, editDocumentV2),
      adjustments: withScene,
      editDocumentV2,
      history: [withScene],
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
    expect(result.afterEditDocumentV2.nodes.scene_curve.params).toMatchObject({
      outputCurveV1: outputCurve,
      sceneCurveV1: sceneCurve,
    });
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

    const current = { ...state.adjustments, rawEngineEditGraphVersion: 2, sceneCurveV1: sceneCurve };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(current);
    useEditorStore.setState({
      adjustmentSnapshot: publishAdjustmentSnapshot(null, current, editDocumentV2),
      adjustments: current,
      editDocumentV2,
      history: [current],
    });
    const noOpState = useEditorStore.getState();
    const noOp = noOpState.applyEditTransaction(
      buildTypedCurveEditTransaction(noOpState, identity(), { curve: sceneCurve, domain: 'scene' }, 'no-op'),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
  });
});
