import { describe, expect, test } from 'bun:test';
import type { Crop, PercentCrop } from 'react-image-crop';
import {
  type CropStraightenCleanupReason,
  type CropStraightenSessionIdentity,
  createCropStraightenController,
  initialCropStraightenControllerState,
  reduceCropStraightenController,
  resolveStraightenCorrection,
} from '../../../src/components/panel/editor/cropStraightenController';

const straightenSession = (overrides: Partial<CropStraightenSessionIdentity> = {}): CropStraightenSessionIdentity => ({
  geometryEpoch: 7,
  imageSessionId: 'editor-image-session:11',
  operationGeneration: 11,
  sourceIdentity: '/fixture/a.raw',
  sourceRevision: 'graph:11',
  tool: 'straighten',
  ...overrides,
});

const crop: Crop = { height: 70, unit: '%', width: 80, x: 10, y: 15 };
const percentCrop: PercentCrop = crop;

describe('crop straighten controller', () => {
  test('preserves the straighten correction for horizontal, vertical, and already-rotated pixels', () => {
    expect(resolveStraightenCorrection({ x: 0, y: 0 }, { x: 100, y: 10 }, 0, { height: 100, width: 100 })).toBeCloseTo(
      -5.710593,
      5,
    );
    expect(resolveStraightenCorrection({ x: 0, y: 0 }, { x: 0, y: 100 }, 0, { height: 100, width: 100 })).toBe(0);
    expect(resolveStraightenCorrection({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, { height: 100, width: 100 })).toBeCloseTo(
      10,
      5,
    );
    expect(resolveStraightenCorrection({ x: 2, y: 2 }, { x: 2, y: 2 }, 0, { height: 100, width: 100 })).toBeNull();
  });

  test('emits pointer ownership, declarative overlay state, and one semantic straighten commit', () => {
    const controller = createCropStraightenController();
    const session = straightenSession();
    controller.dispatch({ session, type: 'session-installed' });

    const started = controller.dispatch({
      identity: session,
      point: { x: 10, y: 20 },
      pointerId: 4,
      renderSize: { height: 200, width: 300 },
      rotationDegrees: 0,
      type: 'pointer-started',
    });
    expect(started.commands).toEqual([{ pointerId: 4, type: 'capture-pointer' }]);
    expect(started.overlay).toMatchObject({
      end: { x: 10, y: 20 },
      geometryEpoch: 7,
      kind: 'straighten-line',
      pointerPolicy: 'capture',
      start: { x: 10, y: 20 },
      zOrder: 'active-tool',
    });

    const moved = controller.dispatch({
      identity: session,
      point: { x: 110, y: 30 },
      pointerId: 4,
      type: 'pointer-moved',
    });
    expect(moved.overlay?.end).toEqual({ x: 110, y: 30 });

    const ended = controller.dispatch({
      identity: session,
      point: { x: 110, y: 30 },
      pointerId: 4,
      type: 'pointer-ended',
    });
    expect(ended.overlay).toBeNull();
    expect(ended.commands[0]).toEqual({ pointerId: 4, reason: 'pointer-ended', type: 'release-pointer' });
    expect(ended.commands[1]).toEqual({
      correctionDegrees: expect.closeTo(-5.710593, 5),
      identity: session,
      type: 'straighten-committed',
    });
  });

  test('rejects same-path reopen and stale source, geometry, generation, and tool events', () => {
    const current = straightenSession();
    const staleIdentities: CropStraightenSessionIdentity[] = [
      straightenSession({ geometryEpoch: 8 }),
      straightenSession({ imageSessionId: 'editor-image-session:12' }),
      straightenSession({ operationGeneration: 12 }),
      straightenSession({ sourceIdentity: '/fixture/b.raw' }),
      straightenSession({ sourceRevision: 'graph:12' }),
      straightenSession({ tool: 'crop' }),
    ];
    for (const identity of staleIdentities) {
      const installed = reduceCropStraightenController(initialCropStraightenControllerState(), {
        session: current,
        type: 'session-installed',
      }).state;
      const result = reduceCropStraightenController(installed, {
        identity,
        point: { x: 1, y: 1 },
        pointerId: 9,
        renderSize: { height: 100, width: 100 },
        rotationDegrees: 0,
        type: 'pointer-started',
      });
      expect(result.ignored).toBeTrue();
      expect(result.state.gesture).toBeNull();
      expect(result.commands).toEqual([]);
    }
  });

  test('session replacement releases one active pointer through identity-specific cleanup reasons', () => {
    const replacements: Array<{
      next: CropStraightenSessionIdentity | null;
      reason: CropStraightenCleanupReason;
    }> = [
      { next: straightenSession({ geometryEpoch: 8 }), reason: 'session-replaced' },
      { next: straightenSession({ imageSessionId: 'editor-image-session:12' }), reason: 'source-changed' },
      { next: straightenSession({ sourceIdentity: '/fixture/b.raw' }), reason: 'source-changed' },
      { next: straightenSession({ sourceRevision: 'graph:12' }), reason: 'source-changed' },
      { next: straightenSession({ tool: 'crop' }), reason: 'tool-changed' },
      { next: null, reason: 'tool-changed' },
    ];
    for (const { next, reason } of replacements) {
      const controller = createCropStraightenController();
      const session = straightenSession();
      controller.dispatch({ session, type: 'session-installed' });
      controller.dispatch({
        identity: session,
        point: { x: 1, y: 1 },
        pointerId: 3,
        renderSize: { height: 100, width: 100 },
        rotationDegrees: 0,
        type: 'pointer-started',
      });
      const replaced = controller.dispatch({ session: next, type: 'session-installed' });
      expect(replaced.commands).toEqual([{ pointerId: 3, reason, type: 'release-pointer' }]);
      expect(replaced.overlay).toBeNull();
      expect(replaced.state.session).toEqual(next);
    }
  });

  test('pointer cancel, lost capture, Escape, blur, and unmount share exact idempotent cleanup', () => {
    const reasons: CropStraightenCleanupReason[] = [
      'pointer-cancel',
      'lost-pointer-capture',
      'escape',
      'blur',
      'unmount',
    ];
    for (const reason of reasons) {
      const controller = createCropStraightenController();
      const session = straightenSession();
      controller.dispatch({ session, type: 'session-installed' });
      controller.dispatch({
        identity: session,
        point: { x: 1, y: 1 },
        pointerId: 5,
        renderSize: { height: 100, width: 100 },
        rotationDegrees: 0,
        type: 'pointer-started',
      });
      const staleCancel = controller.dispatch({ identity: session, pointerId: 6, reason, type: 'cancelled' });
      expect(staleCancel.ignored).toBeTrue();
      expect(staleCancel.overlay).not.toBeNull();
      const cancelled = controller.dispatch({ identity: session, pointerId: 5, reason, type: 'cancelled' });
      expect(cancelled.commands).toEqual([{ pointerId: 5, reason, type: 'release-pointer' }]);
      expect(cancelled.overlay).toBeNull();
      expect(controller.dispatch({ identity: session, pointerId: 5, reason, type: 'cancelled' }).commands).toEqual([]);
    }
  });

  test('routes crop callbacks only for the current crop session', () => {
    const controller = createCropStraightenController();
    const session = straightenSession({ tool: 'crop' });
    controller.dispatch({ session, type: 'session-installed' });
    expect(controller.dispatch({ identity: session, type: 'crop-started' }).commands).toEqual([
      { type: 'crop-started' },
    ]);
    expect(controller.dispatch({ crop, identity: session, percentCrop, type: 'crop-changed' }).commands).toEqual([
      { crop, percentCrop, type: 'crop-changed' },
    ]);
    const stale = controller.dispatch({
      crop,
      identity: { ...session, geometryEpoch: 8 },
      percentCrop,
      type: 'crop-completed',
    });
    expect(stale.ignored).toBeTrue();
    expect(stale.commands).toEqual([]);
  });
});
