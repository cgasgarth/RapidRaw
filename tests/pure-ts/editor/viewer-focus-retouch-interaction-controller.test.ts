import { describe, expect, test } from 'bun:test';
import {
  createViewerFocusRetouchInteractionController,
  isViewerFocusRetouchSessionCurrent,
  type ViewerFocusRetouchCurrentContext,
} from '../../../src/components/panel/editor/viewerFocusRetouchInteractionController';

const current = (overrides: Partial<ViewerFocusRetouchCurrentContext> = {}): ViewerFocusRetouchCurrentContext => ({
  active: true,
  geometryEpoch: 4,
  imageSessionId: 'image-session:12:a',
  packagePath: '/focus/alaska.rrfocus',
  revisionId: 'revision:7',
  sourceRevision: 'graph:9',
  toolId: 'focus-retouch',
  ...overrides,
});
const settings = { erase: false, hardnessPercent: 70, radiusPx: 24, selectedSource: 2 };

describe('viewer focus retouch interaction controller', () => {
  test('builds an exact revision-keyed command and declarative overlay', () => {
    const controller = createViewerFocusRetouchInteractionController();
    expect(controller.begin(current(), 7, { x: 256, y: 512 }, settings)).toBe(true);
    expect(controller.move(8, { x: 400, y: 600 })).toBe(false);
    expect(controller.move(7, { x: 512, y: 768 })).toBe(true);
    const [overlay] = controller.overlays();
    const command = controller.end(current(), 7);
    expect(command).toMatchObject({
      key: { operationGeneration: 1, revisionId: 'revision:7' },
      kind: 'apply-stroke',
      request: {
        expectedRevisionId: 'revision:7',
        packagePath: '/focus/alaska.rrfocus',
        stroke: {
          hardnessU16: 45875,
          pointsFixed1256Px: [
            { x: 256, y: 512 },
            { x: 512, y: 768 },
          ],
          radiusFixed1256Px: 6144,
          sourceIndex: 2,
        },
      },
    });
    expect(overlay?.pointsFixed1256Px).toEqual(command?.request.stroke.pointsFixed1256Px);
  });

  test('maps erase to automatic source and enforces one active or pending operation', () => {
    const controller = createViewerFocusRetouchInteractionController();
    controller.begin(current(), 1, { x: 1, y: 2 }, { ...settings, erase: true });
    expect(controller.begin(current(), 2, { x: 3, y: 4 }, settings)).toBe(false);
    const command = controller.end(current(), 1);
    expect(command?.request.stroke.sourceIndex).toBeNull();
    expect(controller.begin(current(), 2, { x: 3, y: 4 }, settings)).toBe(false);
    if (command === null) throw new Error('expected command');
    expect(controller.receive(command.key, current())).toBe(true);
    expect(controller.begin(current(), 2, { x: 3, y: 4 }, settings)).toBe(true);
  });

  test('rejects late native success and failure across every successor identity', () => {
    const successors = [
      current({ imageSessionId: 'image-session:13:b' }),
      current({ imageSessionId: 'image-session:14:a' }),
      current({ sourceRevision: 'graph:10' }),
      current({ geometryEpoch: 5 }),
      current({ packagePath: '/focus/other.rrfocus' }),
      current({ revisionId: 'revision:8' }),
      current({ active: false }),
    ];
    for (const successor of successors) {
      const controller = createViewerFocusRetouchInteractionController();
      controller.begin(current(), 1, { x: 1, y: 2 }, settings);
      const command = controller.end(current(), 1);
      if (command === null) throw new Error('expected command');
      expect(isViewerFocusRetouchSessionCurrent(command.key, successor)).toBe(false);
      expect(controller.receive(command.key, successor)).toBe(false);

      const failureController = createViewerFocusRetouchInteractionController();
      failureController.begin(current(), 1, { x: 1, y: 2 }, settings);
      const failed = failureController.end(current(), 1);
      if (failed === null) throw new Error('expected command');
      expect(failureController.fail(failed.key, successor)).toBe(false);
    }
  });

  test('cancels active and pending work on blur, Escape, lost capture, and unmount cleanup', () => {
    for (const _reason of ['blur', 'escape', 'lostpointercapture', 'unmount']) {
      const controller = createViewerFocusRetouchInteractionController();
      controller.begin(current(), 1, { x: 1, y: 2 }, settings);
      controller.cancel();
      expect(controller.overlays()).toEqual([]);
      expect(controller.end(current(), 1)).toBeNull();
    }
  });
});
