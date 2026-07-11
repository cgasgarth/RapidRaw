import { afterEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const calls: Array<{ args: Record<string, unknown>; command: string }> = [];
const invoke = mock(async (command: string, args: Record<string, unknown> = {}) => {
  calls.push({ args, command });
  return command === 'load_metadata' ? { adjustments: null } : new Uint8Array([1, 2, 3]);
});
mock.module('@tauri-apps/api/core', () => ({ invoke }));

const { CollageSession, default: CollageModal } = await import('../../../src/components/modals/editing/CollageModal');
type ImageFile = import('../../../src/components/ui/AppProperties').ImageFile;

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  calls.length = 0;
  invoke.mockClear();
  document?.body.replaceChildren();
});

test('keyed reopen starts clean, owns its URLs, and saves the current session exactly once', async () => {
  const runtime = installRuntime();
  cleanup = runtime.unmount;
  const save = mock(async (_data: string, firstPath: string) => `/exports/${firstPath.split('/').pop()}.png`);
  const first = [image('/opaque/set/a.ARW'), image('/opaque/set/b.ARW')];

  await runtime.render('epoch-1', first, save);
  expect(runtime.container.textContent).toContain('modals.collage.spacing');
  expect(runtime.container.querySelector('button[aria-label="a.ARW"]')).not.toBeNull();
  expect(runtime.container.querySelector('button[aria-label="b.ARW"]')).not.toBeNull();

  const spacing = runtime.container.querySelector<HTMLInputElement>('input[type="range"]');
  if (!spacing) throw new Error('Missing spacing control');
  await act(async () => {
    spacing.value = '41';
    spacing.dispatchEvent(new runtime.window.Event('input', { bubbles: true }));
  });

  await runtime.render('epoch-2', first, save);
  const reopenedSpacing = runtime.container.querySelector<HTMLInputElement>('input[type="range"]');
  expect(reopenedSpacing?.value).toBe('15');
  expect(runtime.revoked).toEqual(['blob:1', 'blob:2']);

  const buttons = [...runtime.container.querySelectorAll('button')];
  const saveButton = buttons.find((button) => button.textContent?.includes('modals.collage.saveButton'));
  if (!saveButton) throw new Error('Missing Save button');
  await act(async () => saveButton.click());
  await act(async () => saveButton.click());
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[1]).toBe('/opaque/set/a.ARW');
});

test('disposing during metadata load prevents stale preview work from entering a successor session', async () => {
  const metadataResolvers: Array<() => void> = [];
  invoke.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    calls.push({ args, command });
    if (command !== 'load_metadata') return Promise.resolve(new Uint8Array([1]));
    return new Promise((resolve) => metadataResolvers.push(() => resolve({ adjustments: null })));
  });
  const runtime = installRuntime();
  cleanup = runtime.unmount;
  const save = async () => '/unused.png';

  await runtime.renderWithoutSettling('session-a', [image('/a.ARW')], save);
  await runtime.renderWithoutSettling('session-b', [image('/b.ARW')], save);
  expect(metadataResolvers).toHaveLength(2);
  await act(async () => metadataResolvers[0]?.());
  expect(calls.filter(({ command }) => command === 'generate_preview_for_path')).toHaveLength(0);
  await act(async () => metadataResolvers[1]?.());
  await act(async () => Promise.resolve());
  expect(
    calls.filter(({ command, args }) => command === 'generate_preview_for_path' && args.path === '/b.ARW'),
  ).toHaveLength(1);
  expect(runtime.container.querySelector('button[aria-label="a.ARW"]')).toBeNull();
});

test('the transition shell replaces a same-selection reopen before its first visible frame', async () => {
  const runtime = installRuntime();
  cleanup = runtime.unmount;
  const images = [image('/same/a.ARW'), image('/same/b.ARW')];
  const save = async () => '/unused.png';
  await runtime.renderModal(true, images, save);
  const spacing = runtime.container.querySelector<HTMLInputElement>('input[type="range"]');
  if (!spacing) throw new Error('Missing spacing control');
  await act(async () => {
    spacing.value = '44';
    spacing.dispatchEvent(new runtime.window.Event('input', { bubbles: true }));
  });

  await runtime.renderModal(false, [], save, false);
  await runtime.renderModal(true, images, save);
  expect(runtime.container.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe('15');
});

function image(path: string): ImageFile {
  return { exif: null, is_edited: false, is_virtual_copy: false, modified: 0, path, rating: 0, tags: null };
}

function installRuntime() {
  const window = new Window({ url: 'http://localhost' });
  const revoked: string[] = [];
  let objectUrl = 0;
  class TestImage {
    _src = '';
    height = 800;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    width = 1200;
  }
  Object.defineProperty(TestImage.prototype, 'src', {
    configurable: true,
    get() {
      return this._src ?? '';
    },
    set(value: string) {
      this._src = value;
      queueMicrotask(() => this.onload?.());
    },
  });
  class TestResizeObserver {
    disconnect() {}
    observe() {}
  }
  Object.assign(globalThis, {
    Blob: window.Blob,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Image: TestImage,
    IS_REACT_ACT_ENVIRONMENT: true,
    navigator: window.navigator,
    Node: window.Node,
    ResizeObserver: TestResizeObserver,
    window,
  });
  Object.assign(URL, {
    createObjectURL: () => `blob:${++objectUrl}`,
    revokeObjectURL: (url: string) => revoked.push(url),
  });
  Object.assign(window.HTMLCanvasElement.prototype, {
    getContext: () => ({
      beginPath() {},
      clearRect() {},
      clip() {},
      drawImage() {},
      fillRect() {},
      restore() {},
      roundRect() {},
      save() {},
      scale() {},
      fillStyle: '',
    }),
    toDataURL: () => 'data:image/png;base64,current-session',
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let mounted = true;
  const renderElement = (
    sessionId: string,
    images: ImageFile[],
    onSave: (data: string, path: string) => Promise<string>,
  ) =>
    createElement(CollageSession, {
      key: sessionId,
      onClose: () => {},
      onSave,
      sessionId,
      show: true,
      sourceImages: images,
    });
  return {
    container,
    revoked,
    window,
    render: async (sessionId: string, images: ImageFile[], onSave: (data: string, path: string) => Promise<string>) => {
      await act(async () => root.render(renderElement(sessionId, images, onSave)));
      await act(async () => Promise.resolve());
    },
    renderWithoutSettling: async (
      sessionId: string,
      images: ImageFile[],
      onSave: (data: string, path: string) => Promise<string>,
    ) => {
      await act(async () => root.render(renderElement(sessionId, images, onSave)));
    },
    renderModal: async (
      isOpen: boolean,
      images: ImageFile[],
      onSave: (data: string, path: string) => Promise<string>,
      settle = true,
    ) => {
      await act(async () =>
        root.render(createElement(CollageModal, { isOpen, onClose: () => {}, onSave, sourceImages: images })),
      );
      if (settle) await act(async () => new Promise((resolve) => window.setTimeout(resolve, 20)));
    },
    unmount: async () => {
      if (!mounted) return;
      mounted = false;
      await act(async () => root.unmount());
    },
  };
}
