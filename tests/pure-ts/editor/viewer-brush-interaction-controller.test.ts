import { describe, expect, test } from 'bun:test';
import {
  createViewerBrushInteractionController,
  isViewerBrushCommandCurrent,
  type ViewerBrushCurrentContext,
  type ViewerBrushPointerSample,
} from '../../../src/components/panel/editor/viewerBrushInteractionController';

const context = (overrides: Partial<ViewerBrushCurrentContext> = {}): ViewerBrushCurrentContext => ({
  active: true,
  geometryEpoch: 4,
  imageSessionId: 'image-session:12:a',
  maskId: 'mask:brush',
  sourceRevision: 'graph:9',
  toolId: 'brush',
  ...overrides,
});
const sample = (overrides: Partial<ViewerBrushPointerSample> = {}): ViewerBrushPointerSample => ({
  altKey: false,
  imagePoint: { x: 100, y: 50 },
  pointerId: 7,
  pointerType: 'mouse',
  shiftKey: false,
  viewPoint: { x: 20, y: 30 },
  ...overrides,
});
const settings = { canonicalTool: 'brush' as const, feather: 0.5, imageSpaceSize: 24 };

describe('viewer brush interaction controller', () => {
  test('publishes the exact command line as its declarative overlay for mouse input', () => {
    const controller = createViewerBrushInteractionController();
    controller.begin(context(), sample(), settings);
    controller.move(context(), sample({ imagePoint: { x: 140, y: 90 }, viewPoint: { x: 30, y: 45 } }));
    const [overlay] = controller.overlays();
    const [commit] = controller.end(context());
    expect(commit).toMatchObject({ kind: 'commit', line: { brushSize: 24, feather: 0.5, tool: 'brush' } });
    expect(overlay?.imageLine).toEqual(commit?.kind === 'commit' ? commit.line : null);
  });

  test('preserves touch and pressure-bearing pen samples and latest Alt state', () => {
    for (const pointerType of ['touch', 'pen'] as const) {
      const controller = createViewerBrushInteractionController();
      controller.begin(context(), sample({ imagePoint: { pressure: 0.25, x: 10, y: 20 }, pointerType }), {
        ...settings,
        flow: 20,
      });
      controller.move(
        context(),
        sample({
          altKey: true,
          imagePoint: { pressure: 0.8, x: 20, y: 40 },
          pointerType,
          viewPoint: { x: 30, y: 50 },
        }),
      );
      const [commit] = controller.end(context());
      expect(commit).toMatchObject({
        kind: 'commit',
        line: {
          flow: 20,
          points: [{ pressure: 0.25 }, { pressure: 0.8 }],
          tool: 'eraser',
        },
      });
    }
  });

  test('interpolates Shift successor strokes from the last committed image point', () => {
    const controller = createViewerBrushInteractionController();
    controller.begin(context(), sample({ imagePoint: { x: 2, y: 3 } }), settings);
    controller.end(context());
    const [shiftCommit] = controller.begin(
      context(),
      sample({ imagePoint: { pressure: 0.7, x: 7, y: 3 }, pointerId: 8, pointerType: 'pen', shiftKey: true }),
      settings,
    );
    expect(shiftCommit).toMatchObject({ kind: 'commit', line: { tool: 'brush' } });
    if (shiftCommit?.kind !== 'commit') throw new Error('expected immediate Shift commit');
    expect(shiftCommit.line.points[0]).toMatchObject({ pressure: 0.7, x: 2, y: 3 });
    expect(shiftCommit.line.points.at(-1)).toMatchObject({ pressure: 0.7, x: 7, y: 3 });
    expect(shiftCommit.line.points.length).toBe(6);
  });

  test('cancels through capture loss, pointer cancel, blur, Escape, and unmount', () => {
    for (const reason of ['lostpointercapture', 'pointercancel', 'blur', 'escape', 'unmount'] as const) {
      const controller = createViewerBrushInteractionController();
      controller.begin(context(), sample(), settings);
      expect(controller.cancel(reason)).toMatchObject([{ kind: 'cancel', reason }]);
      expect(controller.overlays()).toEqual([]);
      expect(controller.end(context())).toEqual([]);
    }
  });

  test('rejects competing pointers and resets on exact A to B to A currentness changes', () => {
    const successors = [
      context({ geometryEpoch: 5 }),
      context({ sourceRevision: 'graph:10' }),
      context({ imageSessionId: 'image-session:13:b' }),
      context({ imageSessionId: 'image-session:14:a' }),
      context({ maskId: 'mask:successor' }),
      context({ active: false }),
    ];
    for (const successor of successors) {
      const controller = createViewerBrushInteractionController();
      const [begin] = controller.begin(context(), sample(), settings);
      expect(controller.move(context(), sample({ pointerId: 8 }))).toEqual([]);
      expect(controller.synchronize(successor)).toMatchObject([{ kind: 'cancel', reason: 'session-invalidated' }]);
      expect(controller.overlays()).toEqual([]);
      if (begin === undefined) throw new Error('expected brush session');
      expect(isViewerBrushCommandCurrent(begin.key, successor)).toBe(false);
    }
  });

  test('ignores sub-threshold samples and gives successor operations unique generations', () => {
    const controller = createViewerBrushInteractionController();
    const [first] = controller.begin(context(), sample(), settings);
    expect(controller.move(context(), sample({ viewPoint: { x: 20.5, y: 30.5 } }))).toEqual([]);
    controller.end(context());
    const [second] = controller.begin(context(), sample({ pointerId: 8 }), settings);
    expect(first?.key.operationGeneration).toBe(1);
    expect(second?.key.operationGeneration).toBe(2);
  });
});
