import { describe, expect, test } from 'bun:test';
import {
  createToneCurveTargetInteractionController,
  type ToneCurveTargetCurrentContext,
  type ToneCurveTargetSessionKey,
} from '../../../src/components/panel/editor/toneCurveTargetInteractionController';
import { ActiveChannel } from '../../../src/utils/adjustments';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { buildToneCurveTargetEditTransaction } from '../../../src/utils/toneCurveTargetEditTransaction';

const key = (mode: 'point' | 'parametric' = 'point'): ToneCurveTargetSessionKey => ({
  adjustmentRevision: 4,
  channel: ActiveChannel.Luma,
  geometryEpoch: 8,
  imageSessionId: 'editor-image-session:8',
  mode,
  operationGeneration: 2,
  sourceIdentity: '/private/alaska.ARW',
  sourceRevision: 'render:4',
  selectedPointIndex: null,
  toolId: 'tone-curve',
});

const current = (mode: 'point' | 'parametric' = 'point'): ToneCurveTargetCurrentContext => ({
  active: true,
  adjustmentRevision: 4,
  channel: ActiveChannel.Luma,
  geometryEpoch: 8,
  imageSessionId: 'editor-image-session:8',
  mode,
  sourceIdentity: '/private/alaska.ARW',
  sourceRevision: 'render:4',
  selectedPointIndex: null,
});

const result = {
  imagePointPx: { x: 400, y: 200 },
  luma: 0.4,
  clippedChannels: [],
  requestIdentity: 'sample:4',
  rgb: [0.4, 0.4, 0.4] as [number, number, number],
  spaceLabel: 'Edited display',
  status: 'available' as const,
};

const sampleRequest = {
  geometryEpoch: 8,
  graphRevision: 'render:4',
  imageIdentity: '/private/alaska.ARW',
  normalizedImagePoint: { x: 0.4, y: 0.3 },
  requestIdentity: 'sample:4',
  requestedSpace: 'displayEncoded' as const,
  sampleRadiusImagePx: 0 as const,
  sourceImageSize: { height: 1000, width: 1000 },
  target: 'edited' as const,
};

describe('Tone Curve targeted adjustment controller', () => {
  test('samples the current render, highlights the region, and commits one point-curve gesture', () => {
    const controller = createToneCurveTargetInteractionController();
    const document = createDefaultEditDocumentV2();
    controller.begin({
      baseline: document,
      clientY: 300,
      key: key(),
      point: { normalizedImagePoint: { x: 0.4, y: 0.3 }, viewPoint: { x: 400, y: 300 } },
      pointerId: 3,
      request: sampleRequest,
    });
    expect(controller.receive(key(), result, current())).toEqual([]);
    expect(controller.overlays()[0]).toMatchObject({ mode: 'point', region: 'point', status: 'ready' });
    controller.move(3, 220);
    const [commit] = controller.release(3, 220, selectEditDocumentNode(document, 'scene_curve').params);
    expect(commit).toMatchObject({ kind: 'commit', command: { delta: 80, key: key() } });
    if (commit?.kind === 'commit') {
      expect(commit.command.curve.curves.luma[1]?.y).toBeGreaterThan(0);
    }
  });

  test('maps a parametric sample to its region and rejects stale render receipts', () => {
    const controller = createToneCurveTargetInteractionController();
    const document = createDefaultEditDocumentV2();
    controller.begin({
      baseline: document,
      clientY: 200,
      key: key('parametric'),
      point: { normalizedImagePoint: { x: 0.4, y: 0.3 }, viewPoint: { x: 400, y: 300 } },
      pointerId: 7,
      request: sampleRequest,
    });
    expect(
      controller.receive(key('parametric'), result, { ...current('parametric'), sourceRevision: 'render:stale' }),
    ).toEqual([{ kind: 'clear' }]);
    expect(controller.overlays()).toEqual([]);
    controller.cancel();
    controller.begin({
      baseline: document,
      clientY: 200,
      key: key('parametric'),
      point: { normalizedImagePoint: { x: 0.4, y: 0.3 }, viewPoint: { x: 400, y: 300 } },
      pointerId: 8,
      request: sampleRequest,
    });
    controller.receive(key('parametric'), result, current('parametric'));
    expect(controller.overlays()[0]?.region).toBe('darks');
    const [commit] = controller.commitKeyboard(10, selectEditDocumentNode(document, 'scene_curve').params);
    expect(commit).toMatchObject({ kind: 'commit', command: { delta: 10 } });
    expect(controller.cancel()).toEqual([{ kind: 'clear' }]);
  });

  test('retains a released gesture until the asynchronous sample arrives', () => {
    const controller = createToneCurveTargetInteractionController();
    const document = createDefaultEditDocumentV2();
    controller.begin({
      baseline: document,
      clientY: 200,
      key: key(),
      point: { normalizedImagePoint: { x: 0.4, y: 0.3 }, viewPoint: { x: 400, y: 300 } },
      pointerId: 9,
      request: sampleRequest,
    });
    expect(controller.release(9, 120, selectEditDocumentNode(document, 'scene_curve').params)).toEqual([]);
    const [commit] = controller.receive(key(), result, current());
    expect(commit).toMatchObject({ kind: 'commit', command: { delta: 80 } });
  });

  test('builds one undoable scene-curve transaction and rejects stale identity', () => {
    const document = createDefaultEditDocumentV2();
    const controller = createToneCurveTargetInteractionController();
    controller.begin({
      baseline: document,
      clientY: 200,
      key: key(),
      point: { normalizedImagePoint: { x: 0.4, y: 0.3 }, viewPoint: { x: 400, y: 300 } },
      pointerId: 1,
      request: sampleRequest,
    });
    controller.receive(key(), result, current());
    const [commit] = controller.release(1, 150, selectEditDocumentNode(document, 'scene_curve').params);
    if (commit?.kind !== 'commit') throw new Error('expected targeted curve commit');
    const state = {
      adjustmentRevision: 4,
      editDocumentV2: document,
      geometryEpoch: 8,
      imageSession: { id: 'editor-image-session:8' },
      imageSessionId: 8,
      selectedImage: { path: '/private/alaska.ARW' },
      sourceRevision: 'render:4',
    };
    expect(buildToneCurveTargetEditTransaction(state, commit.command, 'tone-target:1')).toMatchObject({
      baseAdjustmentRevision: 4,
      history: 'single-entry',
      imageSessionId: 'editor-image-session:8',
      source: 'manual-control',
    });
    expect(() =>
      buildToneCurveTargetEditTransaction(
        { ...state, sourceRevision: 'render:stale' },
        commit.command,
        'tone-target:2',
      ),
    ).toThrow('tone_curve_target_transaction.stale_render');
  });
});
