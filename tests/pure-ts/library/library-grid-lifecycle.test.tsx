import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import LibraryGrid from '../../../src/components/panel/library/LibraryGrid';
import {
  type ImageFile,
  LibraryViewMode,
  ThumbnailAspectRatio,
  ThumbnailSize,
} from '../../../src/components/ui/AppProperties';
import { libraryEntityRepository } from '../../../src/library/LibraryEntityRepository';

const images: ImageFile[] = ['/a.raw', '/b.raw', '/c.raw'].map((path) => ({
  path,
  rating: 0,
  modified: 0,
  is_edited: false,
  is_virtual_copy: false,
  tags: null,
  exif: null,
}));

test('keeps the virtual list and surviving thumbnails mounted through ordinary layout transitions', async () => {
  const window = new Window({ url: 'http://localhost' });
  const observers: TestResizeObserver[] = [];
  class TestResizeObserver {
    target: Element | null = null;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      observers.push(this);
    }
    callback: ResizeObserverCallback;
    observe(target: Element) {
      this.target = target;
    }
    unobserve() {}
    disconnect() {}
  }
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    ResizeObserver: TestResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  });
  window.HTMLElement.prototype.scrollTo = function scrollTo(options: ScrollToOptions) {
    this.scrollTop = options.top ?? this.scrollTop;
  };
  libraryEntityRepository.replaceAll(images);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = async (
    imageList: ImageFile[],
    thumbnailSize: ThumbnailSize,
    thumbnailAspectRatio: ThumbnailAspectRatio,
  ) => {
    await act(async () =>
      root.render(
        <LibraryGrid
          imageList={imageList}
          libraryViewMode={LibraryViewMode.Flat}
          thumbnailSize={thumbnailSize}
          currentFolderPath="/"
          activePath="/a.raw"
          multiSelectedPaths={[]}
          onContextMenu={() => {}}
          onImageClick={() => {}}
          onImageDoubleClick={() => {}}
          thumbnailAspectRatio={thumbnailAspectRatio}
          thumbnailSizeOptions={[
            { id: ThumbnailSize.Small, label: 'Small', size: 120 },
            { id: ThumbnailSize.List, label: 'List', size: 40 },
          ]}
          onThumbnailSizeChange={() => {}}
          onClearSelection={() => {}}
          onEmptyAreaContextMenu={() => {}}
        />,
      ),
    );
  };
  const resize = async (width: number, height: number) => {
    await act(async () => {
      for (const observer of observers) {
        if (!observer.target) continue;
        observer.callback(
          [{ contentRect: new window.DOMRect(0, 0, width, height), target: observer.target } as ResizeObserverEntry],
          observer as ResizeObserver,
        );
      }
    });
  };

  await render(images, ThumbnailSize.Small, ThumbnailAspectRatio.Cover);
  await resize(600, 400);
  const list = container.querySelector<HTMLElement>('.custom-scrollbar');
  const thumbnail = container.querySelector<HTMLElement>('[data-image-path="/a.raw"]');
  expect(list).not.toBeNull();
  expect(thumbnail).not.toBeNull();
  if (!list || !thumbnail) throw new Error('Expected the virtual list and active thumbnail');
  Object.defineProperties(list, {
    clientHeight: { value: 400 },
    scrollHeight: { value: 1_000 },
  });
  list.scrollTop = 50;

  await resize(610, 400);
  expect(container.querySelector('.custom-scrollbar')).toBe(list);
  expect(container.querySelector('[data-image-path="/a.raw"]')).toBe(thumbnail);
  expect(list.scrollTop).toBe(50);

  await render(images, ThumbnailSize.Small, ThumbnailAspectRatio.Contain);
  expect(container.querySelector('.custom-scrollbar')).toBe(list);
  expect(container.querySelector('[data-image-path="/a.raw"]')).toBe(thumbnail);

  await render([...images].reverse(), ThumbnailSize.Small, ThumbnailAspectRatio.Contain);
  expect(container.querySelector('.custom-scrollbar')).toBe(list);

  await render([], ThumbnailSize.Small, ThumbnailAspectRatio.Contain);
  expect(container.querySelector('.custom-scrollbar')).toBe(list);

  await render(images, ThumbnailSize.List, ThumbnailAspectRatio.Contain);
  expect(container.querySelector('.custom-scrollbar')).toBe(list);
  await act(async () => root.unmount());
});

afterEach(() => {
  document?.body.replaceChildren();
});
