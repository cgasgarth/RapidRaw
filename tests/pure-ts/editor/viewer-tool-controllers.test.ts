import { describe, expect, test } from 'bun:test';
import { normalizeViewerSurfacePointerEvent } from '../../../src/components/panel/editor/viewerInputRouter';
import {
  createViewerToolSessionRegistry,
  isViewerToolSessionCurrent,
  resolveViewerToolId,
} from '../../../src/components/panel/editor/viewerToolControllers';

const key = (geometryEpoch = 4) => ({
  geometryEpoch,
  imageSessionId: '/private/image-a.arw',
  operationGeneration: 2,
  sourceRevision: 'graph:9',
  toolId: 'brush' as const,
});

describe('viewer tool controllers', () => {
  test('enforces one owner and one cleanup path across brush and pan gestures', () => {
    const registry = createViewerToolSessionRegistry();
    expect(registry.begin(key(), 6, 'blocked')).toBeNull();
    const begin = registry.begin(key(), 7, 'active-tool');
    expect(begin?.kind).toBe('begin');
    expect(registry.begin({ ...key(), toolId: 'pan' }, 8, 'viewer-pan')).toBeNull();
    expect(registry.reduce({ kind: 'update', pointerId: 7 })?.kind).toBe('update');
    expect(registry.reduce({ kind: 'update', pointerId: 8 })).toBeNull();
    expect(registry.reduce({ kind: 'end', pointerId: 7 })?.kind).toBe('end');
    expect(registry.active()).toBeNull();
    expect(registry.begin({ ...key(), toolId: 'pan' }, 8, 'viewer-pan')?.session.key.toolId).toBe('pan');
  });

  test('invalidates sessions when image or geometry identity changes', () => {
    const registry = createViewerToolSessionRegistry();
    registry.begin(key(), 3, 'active-tool');
    const cancelled = registry.invalidate();
    expect(cancelled?.kind).toBe('cancel');
    expect(registry.active()).toBeNull();
    expect(isViewerToolSessionCurrent(key(), key())).toBe(true);
    expect(isViewerToolSessionCurrent(key(), key(5))).toBe(false);
  });

  test('rejects late async results from every successor session identity dimension', () => {
    const current = key();
    const successors = [
      { imageSessionId: '/private/image-b.arw' },
      { sourceRevision: 'graph:10' },
      { operationGeneration: 3 },
      { toolId: 'mask' as const },
    ];
    for (const change of successors) {
      expect(isViewerToolSessionCurrent(current, { ...current, ...change })).toBe(false);
    }
  });

  test('normalizes pointer payloads and maps legacy tool names', () => {
    expect(
      normalizeViewerSurfacePointerEvent({
        clientX: 12,
        clientY: 18,
        pointerId: 4,
        pointerType: 'unknown',
        pressure: 4,
        type: 'pointerdown',
      }),
    ).toMatchObject({ pointerType: 'mouse', pressure: 1 });
    expect(resolveViewerToolId('object-prompt')).toBe('mask');
    expect(resolveViewerToolId('viewer-sampler')).toBe('viewer-sampler');
    expect(resolveViewerToolId('tone-equalizer')).toBe('tone-equalizer');
    expect(resolveViewerToolId('point-color')).toBe('point-color');
    expect(resolveViewerToolId('pan-zoom')).toBe('pan');
  });

  test('keeps the latest pressure-aware pointer sample inside the owned session', () => {
    const registry = createViewerToolSessionRegistry();
    registry.begin(key(), 3, 'active-tool', { clientX: 10, clientY: 20, pointerType: 'pen', pressure: 0.25 });
    const update = registry.reduce({
      kind: 'update',
      pointerId: 3,
      sample: { clientX: 15, clientY: 30, pointerType: 'pen', pressure: 0.75 },
    });
    expect(update?.session.lastPointerSample).toEqual({
      clientX: 15,
      clientY: 30,
      pointerType: 'pen',
      pressure: 0.75,
    });
    expect(registry.active()?.lastPointerSample?.pressure).toBe(0.75);
  });
});
