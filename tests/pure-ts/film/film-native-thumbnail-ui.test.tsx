import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FilmThumbnailRequestV1, FilmThumbnailResultV1 } from '../../../packages/rawengine-schema/src/index.js';

import FilmLookNativeThumbnail from '../../../src/components/adjustments/FilmLookNativeThumbnail';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../src/utils/film-look/filmLookRegistry';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalHTMLElement = globalThis.HTMLElement;
const originalIntersectionObserver = globalThis.IntersectionObserver;
const originalNode = globalThis.Node;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return {
    promise,
    resolve: (value) => {
      if (resolve === null) throw new Error('Deferred promise was not initialized.');
      resolve(value);
    },
  };
};

const readyResult = (requestId: string, marker: string): FilmThumbnailResultV1 => ({
  approximationCodes: [],
  backend: 'gpu',
  cacheStatus: 'miss_rendered',
  dataUrl: `data:image/jpeg;base64,${marker}`,
  elapsedMs: 4.2,
  height: 64,
  key: `sha256:${'1'.repeat(64)}`,
  payloadSha256: `sha256:${'2'.repeat(64)}`,
  payloadBytes: marker.length,
  quality: 'profile_thumbnail_v1',
  rejectionReason: null,
  rendererVersion: 'film-thumbnail-renderer-v1',
  requestId,
  status: 'ready',
  width: 128,
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  Object.assign(globalThis, {
    document: originalDocument,
    HTMLElement: originalHTMLElement,
    IntersectionObserver: originalIntersectionObserver,
    Node: originalNode,
    window: originalWindow,
  });
});

describe('renderer-backed Film look thumbnails', () => {
  test('rejects stale completions and cancels superseded and unmounted native requests', async () => {
    const testWindow = new Window({ url: 'http://localhost' });
    Object.assign(globalThis, {
      document: testWindow.document,
      HTMLElement: testWindow.HTMLElement,
      Node: testWindow.Node,
      window: testWindow,
    });
    container = testWindow.document.createElement('div');
    testWindow.document.body.append(container);
    root = createRoot(container);

    const look = FILM_LOOK_BROWSER_ITEMS[0];
    if (look === undefined) throw new Error('Expected a built-in Film look.');
    const renders: FilmThumbnailRequestV1[] = [];
    const pending: Array<Deferred<FilmThumbnailResultV1>> = [];
    const cancellations: string[] = [];
    const releases: string[] = [];
    const renderThumbnail = (request: FilmThumbnailRequestV1) => {
      renders.push(request);
      const result = deferred<FilmThumbnailResultV1>();
      pending.push(result);
      return result.promise;
    };
    const cancelThumbnail = async (requestId: string) => {
      cancellations.push(requestId);
      return true;
    };
    const render = async (graphRevision: number) => {
      await act(async () => {
        root?.render(
          <FilmLookNativeThumbnail
            baseAdjustments={INITIAL_ADJUSTMENTS}
            graphRevision={graphRevision}
            height={64}
            look={look}
            pinned
            retryLabel="Retry"
            releaseThumbnail={async (key) => {
              releases.push(key);
              return true;
            }}
            renderThumbnail={renderThumbnail}
            cancelThumbnail={cancelThumbnail}
            selectedImageId="image-session-1"
            strength={look.strengthDefault}
            viewOutputSha256={`fnv1a64:${graphRevision.toString(16).padStart(16, '0')}`}
            width={128}
          />,
        );
      });
      await flush();
    };

    await render(1);
    expect(renders).toHaveLength(1);
    await render(2);
    expect(renders).toHaveLength(2);
    expect(cancellations).toContain(renders[0]?.requestId);
    expect(renders[1]?.adjustments.filmLookId).toBe(look.id);
    expect(renders[1]?.adjustments.filmLookStrength).toBe(look.strengthDefault);

    await act(async () => pending[1]?.resolve(readyResult(renders[1]?.requestId ?? '', 'newest')));
    await flush();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,newest');
    expect(container.querySelector('[data-thumbnail-cache-status="miss_rendered"]')).not.toBeNull();
    expect(container.querySelector('[data-thumbnail-elapsed-ms="4.2"]')).not.toBeNull();

    await act(async () => pending[0]?.resolve(readyResult(renders[0]?.requestId ?? '', 'stale')));
    await flush();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,newest');

    const latestRequestId = renders[1]?.requestId;
    act(() => root?.unmount());
    root = null;
    expect(cancellations).toContain(latestRequestId);
    expect(releases).toEqual([`sha256:${'1'.repeat(64)}`]);
  });

  test('does not schedule offscreen work and cancels when a card leaves the viewport', async () => {
    const testWindow = new Window({ url: 'http://localhost' });
    let intersectionCallback: IntersectionObserverCallback | null = null;
    class TestIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      disconnect() {}
      observe() {}
    }
    Object.assign(globalThis, {
      document: testWindow.document,
      HTMLElement: testWindow.HTMLElement,
      IntersectionObserver: TestIntersectionObserver,
      Node: testWindow.Node,
      window: testWindow,
    });
    container = testWindow.document.createElement('div');
    testWindow.document.body.append(container);
    root = createRoot(container);
    const look = FILM_LOOK_BROWSER_ITEMS[0];
    if (look === undefined) throw new Error('Expected a built-in Film look.');
    const renders: FilmThumbnailRequestV1[] = [];
    const cancellations: string[] = [];

    await act(async () => {
      root?.render(
        <FilmLookNativeThumbnail
          baseAdjustments={INITIAL_ADJUSTMENTS}
          cancelThumbnail={async (requestId) => {
            cancellations.push(requestId);
            return true;
          }}
          graphRevision={1}
          height={64}
          look={look}
          pinned={false}
          retryLabel="Retry"
          renderThumbnail={(request) => {
            renders.push(request);
            return new Promise(() => {});
          }}
          selectedImageId="image-session-1"
          strength={look.strengthDefault}
          viewOutputSha256="fnv1a64:0000000000000001"
          width={128}
        />,
      );
    });
    await flush();
    expect(renders).toHaveLength(0);

    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    await flush();
    expect(renders).toHaveLength(1);

    await act(async () => {
      intersectionCallback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    await flush();
    expect(cancellations).toEqual([renders[0]?.requestId]);
    expect(container.querySelector('[data-thumbnail-state="idle"]')).not.toBeNull();
  });
});
