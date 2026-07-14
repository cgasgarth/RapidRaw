import { describe, expect, test } from 'bun:test';
import {
  createViewerPickerInteractionController,
  createViewerPickerContextSynchronizer,
  isViewerPickerSessionCurrent,
  resolveViewerPickerPoint,
  type ViewerPickerCurrentContext,
  type ViewerPickerSessionKey,
} from '../../../src/components/panel/editor/viewerPickerInteractionControllers';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import type { PointColorPickerResponse } from '../../../src/utils/color/pointColorPicker';
import type { ToneEqualizerPickerResponse } from '../../../src/utils/toneEqualizerPicker';

const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
const toneKey = (operationGeneration = 1): ViewerPickerSessionKey & { toolId: 'tone-equalizer' } => ({
  geometryEpoch: 4,
  imageSessionId: 'image-session:12:a',
  operationGeneration,
  sourceIdentity: '/private/image-a.arw',
  sourceRevision: 'graph:9',
  toolId: 'tone-equalizer',
});
const pointKey = (operationGeneration = 1): ViewerPickerSessionKey & { toolId: 'point-color' } => ({
  ...toneKey(operationGeneration),
  toolId: 'point-color',
});
const current = (tool: 'point-color' | 'tone-equalizer' | null = 'tone-equalizer'): ViewerPickerCurrentContext => ({
  activeTool: tool,
  geometryEpoch: 4,
  imageSessionId: 'image-session:12:a',
  sourceIdentity: '/private/image-a.arw',
  sourceRevision: 'graph:9',
});
const toneResult: ToneEqualizerPickerResponse = {
  contributingWeights: [0, 0, 0, 0, 1, 0, 0, 0, 0],
  exposureEv: 0.5,
  graphFingerprint: '1234567890abcdef',
  graphRevision: 'graph:9',
  primaryBand: 4,
  sourceFingerprint: 'abcdef1234567890',
  sourceIdentity: '/private/image-a.arw',
};
const pointResult: PointColorPickerResponse = {
  chroma: 0.2,
  confidence: 0.9,
  graphFingerprint: 'graph-fingerprint',
  graphRevision: 'graph:9',
  hueDegrees: 120,
  lightness: 0.1,
  sampleRadiusPx: 8,
  sourceFingerprint: 'source-fingerprint',
  sourceIdentity: '/private/image-a.arw',
};
const point = resolveViewerPickerPoint({ x: 0.25, y: 0.75 }, { height: 400, width: 800, x: 20, y: 10 });

describe('viewer picker interaction controllers', () => {
  test('owns one picker session and commits a result that arrives before tone release', () => {
    const controller = createViewerPickerInteractionController();
    expect(
      controller.beginToneEqualizer({ adjustments, clientY: 180, key: toneKey(), point, pointerId: 7 }),
    ).toMatchObject([{ kind: 'sample-tone-equalizer', normalizedImagePoint: { x: 0.25, y: 0.75 } }]);
    expect(controller.beginPointColor({ adjustments, key: pointKey(2), point, pointerId: 8 })).toEqual([]);
    expect(controller.receiveToneEqualizer(toneKey(), toneResult, current()).map(({ kind }) => kind)).toEqual([
      'publish-tone-equalizer-receipt',
    ]);
    controller.move(7, 100);
    expect(controller.release(7, 100)).toMatchObject([
      { deltaEv: 1, kind: 'commit-tone-equalizer', result: toneResult },
    ]);
    expect(controller.overlays()).toEqual([]);
  });

  test('accepts immediate input after activation without a delayed invalidation race', () => {
    const controller = createViewerPickerInteractionController();
    const synchronizer = createViewerPickerContextSynchronizer(controller);
    expect(synchronizer.synchronize(current(null))).toEqual([]);
    expect(synchronizer.synchronize(current())).toEqual([]);
    controller.beginToneEqualizer({ adjustments, clientY: 180, key: toneKey(), point, pointerId: 7 });
    expect(synchronizer.synchronize(current())).toEqual([]);
    expect(controller.overlays()).toHaveLength(1);
    expect(synchronizer.synchronize({ ...current(), geometryEpoch: 5 })).toEqual([
      { kind: 'clear-tone-equalizer-receipt' },
    ]);
    expect(controller.overlays()).toEqual([]);
  });

  test('retains a released tone session until its current async result arrives', () => {
    const controller = createViewerPickerInteractionController();
    controller.beginToneEqualizer({ adjustments, clientY: 200, key: toneKey(), point, pointerId: 3 });
    expect(controller.release(3, 280)).toEqual([]);
    expect(controller.receiveToneEqualizer(toneKey(), toneResult, current())).toMatchObject([
      { kind: 'publish-tone-equalizer-receipt' },
      { deltaEv: -1, kind: 'commit-tone-equalizer' },
    ]);
    expect(controller.receiveToneEqualizer(toneKey(), toneResult, current())).toEqual([]);
  });

  test('cancels deterministically and ignores results after blur, Escape, or capture loss', () => {
    for (const _reason of ['blur', 'escape', 'lostpointercapture', 'unmount']) {
      const controller = createViewerPickerInteractionController();
      controller.beginToneEqualizer({ adjustments, clientY: 100, key: toneKey(), point, pointerId: 2 });
      expect(controller.cancel()).toEqual([{ kind: 'clear-tone-equalizer-receipt' }]);
      expect(controller.receiveToneEqualizer(toneKey(), toneResult, current())).toEqual([]);
    }
  });

  test('rejects every stale identity dimension, including image A to B to A', () => {
    const key = toneKey();
    const successors: ViewerPickerCurrentContext[] = [
      { ...current(), imageSessionId: 'image-session:13:b', sourceIdentity: '/private/image-b.arw' },
      { ...current(), imageSessionId: 'image-session:14:a' },
      { ...current(), sourceIdentity: '/private/image-c.arw' },
      { ...current(), sourceRevision: 'graph:10' },
      { ...current(), geometryEpoch: 5 },
      { ...current(), activeTool: 'point-color' },
      { ...current(), activeTool: null },
    ];
    expect(isViewerPickerSessionCurrent(key, current())).toBe(true);
    for (const successor of successors) expect(isViewerPickerSessionCurrent(key, successor)).toBe(false);

    const controller = createViewerPickerInteractionController();
    controller.beginToneEqualizer({ adjustments, clientY: 100, key, point, pointerId: 1 });
    for (const successor of successors) expect(controller.receiveToneEqualizer(key, toneResult, successor)).toEqual([]);
    expect(controller.receiveToneEqualizer({ ...key, operationGeneration: 2 }, toneResult, current())).toEqual([]);
    expect(controller.receiveToneEqualizer(key, { ...toneResult, graphRevision: 'graph:10' }, current())).toEqual([]);
  });

  test('commits one point-color sample and deactivates the one-shot tool', () => {
    const controller = createViewerPickerInteractionController();
    expect(controller.beginPointColor({ adjustments, key: pointKey(), point, pointerId: 9 })[0]).toMatchObject({
      kind: 'sample-point-color',
      normalizedImagePoint: { x: 0.25, y: 0.75 },
    });
    expect(controller.receivePointColor(pointKey(), pointResult, current('point-color'))).toMatchObject([
      { kind: 'commit-point-color', ordinal: 1, result: pointResult },
      { kind: 'deactivate-point-color' },
      { kind: 'publish-point-color-receipt', result: pointResult },
    ]);
  });

  test('uses the exact command coordinate for its declarative overlay at any geometry', () => {
    const mapped = resolveViewerPickerPoint({ x: 0.125, y: 0.6 }, { height: 500, width: 1000, x: 44, y: 22 });
    const controller = createViewerPickerInteractionController();
    const [sample] = controller.beginPointColor({ adjustments, key: pointKey(), point: mapped, pointerId: 1 });
    const [overlay] = controller.overlays();
    expect(sample).toMatchObject({ normalizedImagePoint: { x: 0.125, y: 0.6 } });
    expect(overlay).toMatchObject({
      geometryEpoch: 4,
      normalizedImagePoint: { x: 0.125, y: 0.6 },
      viewPoint: { x: 169, y: 322 },
    });
  });
});
