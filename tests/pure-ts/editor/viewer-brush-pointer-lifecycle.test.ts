import { describe, expect, test } from 'bun:test';
import { createViewerBrushPointerLifecycle } from '../../../src/components/panel/editor/viewerBrushPointerLifecycle';

describe('viewer brush pointer lifecycle', () => {
  test.each([
    'touch',
    'pen',
  ] as const)('accepts one %s pointer and rejects compatibility mouse events', (pointerType) => {
    const lifecycle = createViewerBrushPointerLifecycle();
    expect(lifecycle.begin(pointerType, 7)).toBe(true);
    expect(lifecycle.move(pointerType, 7)).toBe(true);
    expect(lifecycle.begin('mouse', 1)).toBe(false);
    expect(lifecycle.move('mouse', 1)).toBe(false);
    expect(lifecycle.end(pointerType, 7)).toBe(true);
    expect(lifecycle.begin('mouse', 1)).toBe(false);
    lifecycle.releaseCompatibilityMouse();
    expect(lifecycle.begin('mouse', 1)).toBe(true);
  });

  test('rejects competing and duplicate pointers and consumes one release exactly once', () => {
    const lifecycle = createViewerBrushPointerLifecycle();
    expect(lifecycle.begin('mouse', 1)).toBe(true);
    expect(lifecycle.begin('mouse', 1)).toBe(false);
    expect(lifecycle.begin('touch', 2)).toBe(false);
    expect(lifecycle.end('mouse', 9)).toBe(false);
    expect(lifecycle.end('mouse', 1)).toBe(true);
    expect(lifecycle.end('mouse', 1)).toBe(false);
  });

  test('cancel clears pointer ownership and compatibility suppression atomically', () => {
    const lifecycle = createViewerBrushPointerLifecycle();
    lifecycle.begin('pen', 3);
    lifecycle.cancel();
    expect(lifecycle.snapshot()).toEqual({ active: null, compatibilityMouseSuppressed: false });
    expect(lifecycle.begin('mouse', 1)).toBe(true);
  });
});
