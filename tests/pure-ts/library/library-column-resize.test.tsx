import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, memo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
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

function installDom() {
  const window = new Window({ url: 'http://localhost' });
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
  return {
    window,
    flush: () => {
      const pending = callbacks;
      callbacks = new Map();
      pending.forEach((callback) => callback(0));
    },
    pending: () => callbacks.size,
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

afterEach(() => {
  document?.body.replaceChildren();
});

describe('library column resize journey', () => {
  test('coalesces hundreds of moves and commits exactly once on release', async () => {
    const dom = installDom();
    const commits: ColumnWidths[] = [];
    const renders = { count: 0 };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Harness commit={(widths) => commits.push(widths)} renders={renders} />));
    const grid = container.querySelector('[data-testid="root"]') as HTMLElement;
    const handle = container.querySelector('[data-testid="handle"]') as HTMLElement;
    Object.defineProperty(grid, 'clientWidth', { value: 1_000 });
    const captured = new Set<number>();
    handle.setPointerCapture = (id) => captured.add(id);
    handle.hasPointerCapture = (id) => captured.has(id);
    handle.releasePointerCapture = (id) => captured.delete(id);
    const fire = (type: string, clientX: number) =>
      handle.dispatchEvent(
        new dom.window.PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, clientX }),
      );

    await act(async () => {
      fire('pointerdown', 100);
      for (let index = 0; index < 500; index++) fire('pointermove', 100 + index);
    });
    expect(commits).toHaveLength(0);
    expect(dom.pending()).toBe(1);
    expect(renders.count).toBe(1);
    await act(async () => dom.flush());
    expect(grid.style.getPropertyValue('--library-col-thumbnail')).not.toBe('');
    await act(async () => fire('pointerup', 599));
    expect(commits).toHaveLength(1);
    expect(renders.count).toBe(1);
    expect(captured.size).toBe(0);
    await act(async () => root.unmount());
  });

  test('Escape restores initial CSS without committing and unmount cancels a frame', async () => {
    const dom = installDom();
    let commits = 0;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Harness commit={() => commits++} />));
    const grid = container.querySelector('[data-testid="root"]') as HTMLElement;
    const handle = container.querySelector('[data-testid="handle"]') as HTMLElement;
    Object.defineProperty(grid, 'clientWidth', { value: 1_000 });
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => false;
    handle.releasePointerCapture = () => {};
    await act(async () => {
      handle.dispatchEvent(
        new dom.window.PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 2,
          pointerType: 'mouse',
          button: 0,
          clientX: 0,
        }),
      );
      handle.dispatchEvent(new dom.window.PointerEvent('pointermove', { bubbles: true, pointerId: 2, clientX: 200 }));
    });
    expect(dom.pending()).toBe(1);
    await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })));
    expect(commits).toBe(0);
    expect(dom.pending()).toBe(0);
    expect(grid.style.getPropertyValue('--library-col-thumbnail')).toBe(`${(4 / 55) * 100}%`);
    await act(async () => root.unmount());
    expect(document.documentElement.style.getPropertyValue('user-select')).toBe('');
  });
});
