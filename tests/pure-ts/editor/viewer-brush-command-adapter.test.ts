import { describe, expect, test } from 'bun:test';
import { createViewerBrushCommandAdapter } from '../../../src/components/panel/editor/viewerBrushCommandAdapter';
import {
  createViewerBrushInteractionController,
  type ViewerBrushCurrentContext,
  type ViewerBrushPointerSample,
} from '../../../src/components/panel/editor/viewerBrushInteractionController';
import { Mask, type SubMask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';

const current: ViewerBrushCurrentContext = {
  active: true,
  geometryEpoch: 4,
  imageSessionId: 'image-session:12:a',
  maskId: 'mask:brush',
  sourceRevision: 'graph:9',
  toolId: 'brush',
};
const subMask: SubMask = {
  id: current.maskId,
  invert: false,
  mode: SubMaskMode.Additive,
  name: 'Brush proof',
  opacity: 100,
  parameters: { lines: [] },
  type: Mask.Brush,
  visible: true,
};
const sample = (pointerId: number, x: number): ViewerBrushPointerSample => ({
  altKey: pointerId === 2,
  imagePoint: { pressure: 0.5, x, y: 20 },
  pointerId,
  pointerType: 'pen',
  shiftKey: false,
  viewPoint: { x, y: 20 },
});

describe('viewer brush command adapter', () => {
  test('preserves a committed first stroke when successor props are still stale', () => {
    const patches: Array<Partial<SubMask>> = [];
    const adapter = createViewerBrushCommandAdapter((_id, patch) => patches.push(patch));
    const controller = createViewerBrushInteractionController();
    const settings = { canonicalTool: 'brush' as const, feather: 0.5, imageSpaceSize: 24 };
    const commitContext = {
      current,
      imagePath: '/raws/alaska/a.arw',
      imageSize: { height: 100, width: 200 },
      parameters: { lines: [] },
      subMask,
    };

    controller.begin(current, sample(1, 10), settings);
    const [first] = controller.end(current);
    if (first?.kind !== 'commit') throw new Error('expected first commit');
    expect(adapter.commit(first, commitContext)?.summary).toMatchObject({ lastStrokeMode: 'paint', strokeCount: 1 });

    controller.begin(current, sample(2, 30), settings);
    const [second] = controller.end(current);
    if (second?.kind !== 'commit') throw new Error('expected second commit');
    const result = adapter.commit(second, commitContext);
    expect(result?.summary).toMatchObject({ lastStrokeMode: 'erase', strokeCount: 2 });
    expect(result?.parameters.lines?.map((line) => line.tool)).toEqual(['brush', 'eraser']);
    expect(patches).toHaveLength(2);
  });

  test('rejects a delayed command after image, source, geometry, mask, or tool invalidation', () => {
    const adapter = createViewerBrushCommandAdapter(() => {
      throw new Error('stale command must not mutate');
    });
    const controller = createViewerBrushInteractionController();
    controller.begin(current, sample(1, 10), { canonicalTool: 'brush', feather: 0.5, imageSpaceSize: 24 });
    const [command] = controller.end(current);
    if (command?.kind !== 'commit') throw new Error('expected commit');
    const successors = [
      { ...current, imageSessionId: 'image-session:13:b' },
      { ...current, sourceRevision: 'graph:10' },
      { ...current, geometryEpoch: 5 },
      { ...current, maskId: 'mask:other' },
      { ...current, active: false },
    ];
    for (const successor of successors) {
      expect(
        adapter.commit(command, {
          current: successor,
          imagePath: '/raws/alaska/a.arw',
          imageSize: { height: 100, width: 200 },
          parameters: { lines: [] },
          subMask,
        }),
      ).toBeNull();
    }
  });
});
