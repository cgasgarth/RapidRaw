import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import type { CullingSuggestions, ImageAnalysisResult } from '../../../src/components/ui/AppProperties';
import en from '../../../src/i18n/locales/en.json';

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

const requests: Deferred<CullingSuggestions>[] = [];
const invoke = mock(() => {
  const request = deferred<CullingSuggestions>();
  requests.push(request);
  return request.promise;
});
mock.module('@tauri-apps/api/core', () => ({ invoke }));

const { default: CullingModal } = await import('../../../src/components/modals/editing/CullingModal');
const { buildInitialCullingDecision, reduceCullingDecision } = await import(
  '../../../src/components/modals/editing/cullingSessionModel'
);

let runtime: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (runtime) act(() => runtime?.root.unmount());
  runtime?.container.remove();
  runtime = null;
  requests.length = 0;
  invoke.mockClear();
});

describe('culling decision session', () => {
  test('initializes available suggestion paths and the first active path synchronously', () => {
    const state = buildInitialCullingDecision(['/a.ARW', '/b.jpg'], suggestions('/a.ARW', '/b.jpg', '/gone.jpg'));
    expect(state.activePath).toBe('/a.ARW');
    expect([...state.selectedRejects]).toEqual(['/b.jpg']);
  });

  test('does not overwrite a reviewer edit when suggestions resolve late', () => {
    let state = buildInitialCullingDecision(['/a.ARW', '/b.jpg'], null);
    state = reduceCullingDecision(state, { path: '/a.ARW', type: 'toggle' });
    state = reduceCullingDecision(state, {
      paths: ['/a.ARW', '/b.jpg'],
      suggestions: suggestions('/a.ARW', '/b.jpg'),
      type: 'suggestionsResolved',
    });
    expect([...state.selectedRejects]).toEqual(['/a.ARW']);
    expect(state.reviewerChangedDecision).toBe(true);
  });

  test('owns range decisions by stable path through removal and reorder', () => {
    let state = buildInitialCullingDecision(['/a', '/b', '/c'], null);
    state = reduceCullingDecision(state, { paths: ['/a', '/c'], rejected: true, type: 'setRange' });
    expect([...state.selectedRejects]).toEqual(['/a', '/c']);

    const nextSession = buildInitialCullingDecision(['/c', '/b'], suggestions('/b', '/c', '/a'));
    expect([...nextSession.selectedRejects]).toEqual(['/c']);
    expect(nextSession.selectedRejects.has('/a')).toBe(false);
    expect(reduceCullingDecision(nextSession, { type: 'resetToSuggestions' }).selectedRejects.has('/a')).toBe(false);
  });

  test('reset-to-suggestions explicitly restores defaults', () => {
    let state = buildInitialCullingDecision(['/a', '/b'], suggestions('/a', '/b'));
    state = reduceCullingDecision(state, { path: '/b', type: 'toggle' });
    expect(state.selectedRejects.size).toBe(0);
    state = reduceCullingDecision(state, { type: 'resetToSuggestions' });
    expect([...state.selectedRejects]).toEqual(['/b']);
  });

  test('ignores a closed session response and applies the current decision set exactly once', async () => {
    const onApply = mock(() => undefined);
    const onClose = mock(() => undefined);
    const { container, render } = await installRuntime(onApply, onClose);

    await render({ isOpen: true, paths: ['/old.ARW'], suggestions: null });
    await clickButton(container, 'Start Culling');
    expect(requests).toHaveLength(1);
    await render({ isOpen: false, paths: [], suggestions: null });
    await act(async () => requests[0]?.resolve(suggestions('/old.ARW', '/old.ARW')));

    const current = suggestions('/new.ARW', '/new.jpg');
    await render({ isOpen: true, paths: ['/new.ARW', '/new.jpg'], suggestions: current });
    expect(container.querySelector<HTMLElement>('[data-testid="culling-session"]')?.dataset.cullingActivePath).toBe(
      '/new.ARW',
    );
    expect(selectedCount(container)).toContain('1 result selected');
    await clickButton(container, 'Apply to 1');
    await clickButton(container, 'Apply to 1');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('reject', ['/new.jpg']);
  });

  test('Cancel writes nothing and reopening the same paths creates a fresh decision session', async () => {
    const onApply = mock(() => undefined);
    const onClose = mock(() => undefined);
    const initial = suggestions('/same.ARW', '/same.jpg');
    const { container, render } = await installRuntime(onApply, onClose);
    await render({ isOpen: true, paths: ['/same.ARW', '/same.jpg'], suggestions: initial });
    await clickImage(container, '/same.jpg');
    expect(selectedCount(container)).toContain('0 results selected');
    await clickButton(container, 'Cancel');
    expect(onApply).not.toHaveBeenCalled();

    await render({ isOpen: false, paths: [], suggestions: null });
    await render({ isOpen: true, paths: ['/same.ARW', '/same.jpg'], suggestions: initial });
    expect(selectedCount(container)).toContain('1 result selected');
  });
});

async function installRuntime(
  onApply: (action: 'reject' | 'rate_zero' | 'delete', paths: string[]) => void,
  onClose: () => void,
) {
  const window = new Window({ url: 'http://localhost' });
  Object.assign(globalThis, {
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    navigator: window.navigator,
    Node: window.Node,
    window,
  });
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({ fallbackLng: 'en', lng: 'en', resources: { en: { translation: en } } });
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  runtime = { container, root };
  return {
    container,
    render: async ({
      isOpen,
      paths,
      suggestions: value,
    }: {
      isOpen: boolean;
      paths: string[];
      suggestions: CullingSuggestions | null;
    }) => {
      await act(async () => {
        root.render(
          createElement(
            I18nextProvider,
            { i18n: i18next },
            createElement(CullingModal, {
              error: null,
              getThumbnailUrl: (path: string) => `data:image/jpeg,${encodeURIComponent(path)}`,
              imagePaths: paths,
              isOpen,
              onApply,
              onClose,
              onError: () => undefined,
              progress: null,
              suggestions: value,
            }),
          ),
        );
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      });
    },
  };
}

async function clickButton(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => {
    button.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  });
}

async function clickImage(container: HTMLElement, alt: string) {
  const image = container.querySelector<HTMLImageElement>(`img[alt="${alt}"]`);
  if (!image?.parentElement?.parentElement) throw new Error(`Missing image: ${alt}`);
  await act(async () => {
    image.parentElement?.parentElement?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  });
}

function selectedCount(container: HTMLElement): string {
  return container.querySelector('[data-testid="culling-selected-result-count"]')?.textContent ?? '';
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function image(path: string): ImageAnalysisResult {
  return {
    centerFocusMetric: 100,
    exposureMetric: 0.5,
    eyeSharpnessMetric: 100,
    faceSharpnessMetric: 100,
    focusConfidence: 0.8,
    focusRegion: 'center_fallback',
    focusScore: 0.8,
    height: 100,
    path,
    qualityScore: 0.8,
    sharpnessMetric: 100,
    width: 100,
  };
}

function suggestions(representativePath: string, duplicatePath: string, stalePath?: string): CullingSuggestions {
  return {
    blurryImages: stalePath ? [image(stalePath)] : [],
    failedPaths: [],
    focusRankings: [],
    latencyReport: null,
    similarGroups: [{ duplicates: [image(duplicatePath)], representative: image(representativePath) }],
  };
}
