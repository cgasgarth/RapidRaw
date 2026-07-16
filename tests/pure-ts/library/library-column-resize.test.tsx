import { describe, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import { memo, useRef } from 'react';
import { CORE_LIBRARY_COLUMN_KEYS } from '../../../src/components/panel/library/libraryColumnWidths';
import { useLibraryColumnResize } from '../../../src/components/panel/library/useLibraryColumnResize';
import type { ColumnWidths } from '../../../src/components/panel/MainLibrary';

const initial: ColumnWidths = {
  thumbnail: 4,
  name: 20,
  date: 15,
  rating: 8,
  color: 8,
  shutter: 10,
  aperture: 10,
  iso: 10,
  focal: 15,
};

function installFrameDriver() {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
  return {
    flush: () => {
      const pending = callbacks;
      callbacks = new Map();
      pending.forEach((callback) => callback(0));
    },
    pending: () => callbacks.size,
    restore: () => {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    },
  };
}

const RowProbe = memo(({ renders }: { renders: { count: number } }) => {
  renders.count++;
  return <div data-testid="row" />;
});

function Harness({
  commit,
  renders = { count: 0 },
}: {
  commit: (widths: ColumnWidths) => void;
  renders?: { count: number };
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const resize = useLibraryColumnResize({
    committedWidths: initial,
    rootRef,
    visibleColumns: CORE_LIBRARY_COLUMN_KEYS,
    commitWidths: commit,
  });
  return (
    <div ref={rootRef} data-testid="root">
      <RowProbe renders={renders} />
      <div
        data-testid="handle"
        role="separator"
        tabIndex={0}
        onPointerDown={(event) => resize.onPointerDown(event, 'thumbnail', 'name')}
        onPointerMove={resize.onPointerMove}
        onPointerUp={resize.onPointerUp}
        onPointerCancel={resize.onPointerCancel}
        onLostPointerCapture={resize.onLostPointerCapture}
      />
    </div>
  );
}

describe('library column resize journey', () => {
  test('coalesces hundreds of moves and commits exactly once on release', async () => {
    const frames = installFrameDriver();
    const commits: ColumnWidths[] = [];
    const renders = { count: 0 };
    const view = render(<Harness commit={(widths) => commits.push(widths)} renders={renders} />);
    const { container } = view;
    const grid = container.querySelector('[data-testid="root"]') as HTMLElement;
    const handle = container.querySelector('[data-testid="handle"]') as HTMLElement;
    Object.defineProperty(grid, 'clientWidth', { value: 1_000 });
    const captured = new Set<number>();
    handle.setPointerCapture = (id) => captured.add(id);
    handle.hasPointerCapture = (id) => captured.has(id);
    handle.releasePointerCapture = (id) => captured.delete(id);
    const fire = (type: string, clientX: number) =>
      handle.dispatchEvent(
        new window.PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, clientX }),
      );

    await act(async () => {
      fire('pointerdown', 100);
      for (let index = 0; index < 500; index++) fire('pointermove', 100 + index);
    });
    expect(commits).toHaveLength(0);
    expect(frames.pending()).toBe(1);
    expect(renders.count).toBe(1);
    await act(async () => frames.flush());
    expect(grid.style.getPropertyValue('--library-col-thumbnail')).not.toBe('');
    await act(async () => fire('pointerup', 599));
    expect(commits).toHaveLength(1);
    expect(renders.count).toBe(1);
    expect(captured.size).toBe(0);
    view.unmount();
    frames.restore();
  });

  test('Escape restores initial CSS without committing and unmount cancels a frame', async () => {
    const frames = installFrameDriver();
    let commits = 0;
    const view = render(<Harness commit={() => commits++} />);
    const { container } = view;
    const grid = container.querySelector('[data-testid="root"]') as HTMLElement;
    const handle = container.querySelector('[data-testid="handle"]') as HTMLElement;
    Object.defineProperty(grid, 'clientWidth', { value: 1_000 });
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => false;
    handle.releasePointerCapture = () => {};
    await act(async () => {
      handle.dispatchEvent(
        new window.PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 2,
          pointerType: 'mouse',
          button: 0,
          clientX: 0,
        }),
      );
      handle.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, pointerId: 2, clientX: 200 }));
    });
    expect(frames.pending()).toBe(1);
    await act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })));
    expect(commits).toBe(0);
    expect(frames.pending()).toBe(0);
    expect(grid.style.getPropertyValue('--library-col-thumbnail')).toBe(`${(4 / 55) * 100}%`);
    view.unmount();
    frames.restore();
    expect(document.documentElement.style.getPropertyValue('user-select')).toBe('');
  });
});
