import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render as testingRender, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';

const calls: Array<{ args: Record<string, unknown>; command: string }> = [];
const defaultInvoke = async (command: string, args: Record<string, unknown> = {}) => {
  calls.push({ args, command });
  return command === 'load_metadata' ? { adjustments: null } : [1, 2, 3];
};
const invoke = mock(defaultInvoke);
mock.module('@tauri-apps/api/core', () => ({ invoke }));

const { CollageSession, default: CollageModal } = await import('../../../src/components/modals/editing/CollageModal');
type ImageFile = import('../../../src/components/ui/AppProperties').ImageFile;

let cleanup: (() => Promise<void>) | null = null;

beforeEach(() => {
  invoke.mockImplementation(defaultInvoke);
});

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  calls.length = 0;
  invoke.mockClear();
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
  fireEvent.input(spacing, { target: { value: '41' } });

  await runtime.render('epoch-2', first, save);
  const reopenedSpacing = runtime.container.querySelector<HTMLInputElement>('input[type="range"]');
  expect(reopenedSpacing?.value).toBe('15');
  expect(runtime.revoked).toEqual(['blob:1', 'blob:2']);

  const buttons = [...runtime.container.querySelectorAll('button')];
  const saveButton = buttons.find((button) => button.textContent?.includes('modals.collage.saveButton'));
  if (!saveButton) throw new Error('Missing Save button');
  await runtime.user.click(saveButton);
  await runtime.user.click(saveButton);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[1]).toBe('/opaque/set/a.ARW');
});

test('disposing during metadata load prevents stale preview work from entering a successor session', async () => {
  const metadataResolvers: Array<() => void> = [];
  invoke.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    calls.push({ args, command });
    if (command !== 'load_metadata') return Promise.resolve([1]);
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
    calls.filter(({ command, args }) => command === 'generate_preview_for_path' && args['path'] === '/b.ARW'),
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
  fireEvent.input(spacing, { target: { value: '44' } });

  await runtime.renderModal(false, [], save, false);
  await runtime.renderModal(true, images, save);
  expect(runtime.container.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe('15');
});

function image(path: string): ImageFile {
  return { exif: null, is_edited: false, is_virtual_copy: false, modified: 0, path, rating: 0, tags: null };
}

function installRuntime() {
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
  const imageDescriptor = Object.getOwnPropertyDescriptor(window, 'Image');
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const getContextDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
  const originalToDataUrl = HTMLCanvasElement.prototype.toDataURL;
  Object.defineProperty(window, 'Image', { configurable: true, value: TestImage });
  URL.createObjectURL = (blob: Blob) => {
    if (blob.size === 0) throw new Error('Preview Blob must contain native bytes');
    return `blob:${++objectUrl}`;
  };
  URL.revokeObjectURL = (url: string) => revoked.push(url);
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({
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
  });
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,current-session';
  const rendered = testingRender(
    createElement(CollageModal, { isOpen: false, onClose: () => {}, onSave: async () => '', sourceImages: [] }),
  );
  const user = userEvent.setup();
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
    container: rendered.container,
    revoked,
    user,
    render: async (sessionId: string, images: ImageFile[], onSave: (data: string, path: string) => Promise<string>) => {
      rendered.rerender(renderElement(sessionId, images, onSave));
      const firstName = images[0]?.path.split(/[\\/]/u).at(-1);
      if (firstName !== undefined) {
        await waitFor(() => {
          if (rendered.container.querySelector(`button[aria-label="${firstName}"]`) === null) {
            throw new Error(`Waiting for collage source ${firstName}.`);
          }
        });
      }
    },
    renderWithoutSettling: async (
      sessionId: string,
      images: ImageFile[],
      onSave: (data: string, path: string) => Promise<string>,
    ) => {
      rendered.rerender(renderElement(sessionId, images, onSave));
    },
    renderModal: async (
      isOpen: boolean,
      images: ImageFile[],
      onSave: (data: string, path: string) => Promise<string>,
      settle = true,
    ) => {
      rendered.rerender(createElement(CollageModal, { isOpen, onClose: () => {}, onSave, sourceImages: images }));
      if (settle) {
        await waitFor(() => {
          if (rendered.container.querySelector('input[type="range"]') === null) {
            throw new Error('Collage modal did not reach its visible frame.');
          }
        });
      }
    },
    unmount: async () => {
      if (!mounted) return;
      mounted = false;
      rendered.unmount();
      if (imageDescriptor === undefined) Reflect.deleteProperty(window, 'Image');
      else Object.defineProperty(window, 'Image', imageDescriptor);
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
      if (getContextDescriptor === undefined) Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext');
      else Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', getContextDescriptor);
      HTMLCanvasElement.prototype.toDataURL = originalToDataUrl;
      await Promise.resolve();
    },
  };
}
