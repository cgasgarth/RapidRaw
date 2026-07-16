import { expect, test } from 'bun:test';
import { act, render as testingRender } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import LibraryGrid from '../../../src/components/panel/library/LibraryGrid';
import {
  type ImageFile,
  LibraryViewMode,
  ThumbnailAspectRatio,
  ThumbnailSize,
} from '../../../src/components/ui/AppProperties';
import { libraryEntityRepository } from '../../../src/library/LibraryEntityRepository';

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {} } } });

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
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalScrollTo = window.HTMLElement.prototype.scrollTo;
  globalThis.ResizeObserver = TestResizeObserver;
  window.HTMLElement.prototype.scrollTo = function scrollTo(options: ScrollToOptions) {
    this.scrollTop = options.top ?? this.scrollTop;
  };
  libraryEntityRepository.replaceAll(images);
  let view: ReturnType<typeof testingRender> | null = null;
  const render = async (
    imageList: ImageFile[],
    thumbnailSize: ThumbnailSize,
    thumbnailAspectRatio: ThumbnailAspectRatio,
  ) => {
    const element = (
      <I18nextProvider i18n={i18n}>
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
        />
      </I18nextProvider>
    );
    if (view === null) view = testingRender(element);
    else view.rerender(element);
    await act(() => Promise.resolve());
  };
  const resize = async (width: number, height: number) => {
    await act(async () => {
      for (const observer of observers) {
        if (!observer.target) continue;
        const contentRect = new DOMRect(0, 0, width, height);
        const observedSize = [{ blockSize: height, inlineSize: width }];
        observer.callback(
          [
            {
              borderBoxSize: observedSize,
              contentBoxSize: observedSize,
              contentRect,
              devicePixelContentBoxSize: observedSize,
              target: observer.target,
            },
          ],
          observer,
        );
      }
    });
  };

  await render(images, ThumbnailSize.Small, ThumbnailAspectRatio.Cover);
  if (view === null) throw new Error('Expected library grid view');
  const { container } = view;
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
  view.unmount();
  globalThis.ResizeObserver = originalResizeObserver;
  window.HTMLElement.prototype.scrollTo = originalScrollTo;
});
