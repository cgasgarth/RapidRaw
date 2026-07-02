#!/usr/bin/env bun

import { mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { Invokes } from '../../../../src/tauri/commands.ts';

type Deferred<T> = {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
};

const deferredPreviewA = createDeferred<unknown>();
const deferredPreviewB = createDeferred<unknown>();

mock.module('@tauri-apps/api/core', () => ({
  invoke: mock((command: string, args?: Record<string, unknown>) => {
    if (command === Invokes.GeneratePreviewForPath) return Promise.resolve(new Uint8Array([1, 2, 3]));
    if (command === Invokes.PreviewNegativeConversion) {
      return Promise.resolve('data:image/png;base64,iVBORw0KGgo=');
    }
    if (command === Invokes.RenderNegativeLabDryRunPreviewArtifact) {
      const path = typeof args?.path === 'string' ? args.path : '';
      if (path.includes('scan-a')) return deferredPreviewA.promise;
      if (path.includes('scan-b')) return deferredPreviewB.promise;
      throw new Error(`Unexpected preview path: ${path}`);
    }
    return Promise.resolve(null);
  }),
}));

mock.module('@tauri-apps/api/event', () => ({
  listen: mock(() => Promise.resolve(() => undefined)),
}));

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const i18n = await createTestI18n(locale);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const { NegativeConversionModal } = await import(
  '../../../../src/components/modals/negative-lab/NegativeConversionModal.tsx'
);

const rendered = await renderNegativeLabModal(['/roll/scan-a.dng']);
await rerenderNegativeLabModal(rendered.root, ['/roll/scan-b.dng']);

deferredPreviewA.resolve({
  artifactId: 'artifact_negative_lab_runtime_preview_a',
  baseFogSampleSummary: {
    clippedFraction: 0,
    confidence: 0.81,
    densityRange: 0.07,
    densityRgb: {
      b: 0.55,
      g: 0.51,
      r: 0.48,
    },
    meanRgb: {
      b: 0.2818,
      g: 0.309,
      r: 0.3311,
    },
    sampleCount: 400,
    sampleRect: {
      height: 0.6,
      width: 0.12,
      x: 0.02,
      y: 0.2,
    },
    source: 'deterministic_edge_safe_default_rect',
    warningCodes: [],
  },
  contentHash: 'sha256:29eb2bf9f0d4f4f98fb8617d6e6aa0964085d8fa8f11d8d3c7d5ef0cfb2b6d4a',
  dimensions: { height: 1, width: 1 },
  previewDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==',
  renderer: 'rawengine_negative_lab_runtime_preview_v1',
  storage: 'temp_cache',
});
await act(async () => {
  await flushTimers();
});

assertWorkspacePreviewReady(rendered.container, 'false', 'Stale preview A must not mark workspace ready.');

deferredPreviewB.resolve({
  artifactId: 'artifact_negative_lab_runtime_preview_b',
  baseFogSampleSummary: {
    clippedFraction: 0,
    confidence: 0.81,
    densityRange: 0.07,
    densityRgb: {
      b: 0.55,
      g: 0.51,
      r: 0.48,
    },
    meanRgb: {
      b: 0.2818,
      g: 0.309,
      r: 0.3311,
    },
    sampleCount: 400,
    sampleRect: {
      height: 0.6,
      width: 0.12,
      x: 0.02,
      y: 0.2,
    },
    source: 'deterministic_edge_safe_default_rect',
    warningCodes: [],
  },
  contentHash: 'sha256:8688d24999f6cad886e3f7ddac4ff622df5455070a89cfc8f873867bad07c735',
  dimensions: { height: 1, width: 1 },
  previewDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==',
  renderer: 'rawengine_negative_lab_runtime_preview_v1',
  storage: 'temp_cache',
});
await act(async () => {
  await flushTimers();
});

assertWorkspacePreviewReady(rendered.container, 'true', 'Current preview B should mark workspace ready.');

rendered.unmount();
console.log('negative lab runtime preview staleness ok');

async function renderNegativeLabModal(targetPaths: string[]): Promise<{
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
}> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(NegativeConversionModal, {
          isOpen: true,
          onClose: () => undefined,
          onSave: () => undefined,
          targetPaths,
        }),
      ),
    );
    await flushTimers();
  });

  return {
    container,
    root,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function rerenderNegativeLabModal(root: Root, targetPaths: string[]) {
  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(NegativeConversionModal, {
          isOpen: true,
          onClose: () => undefined,
          onSave: () => undefined,
          targetPaths,
        }),
      ),
    );
    await flushTimers();
  });
}

function assertWorkspacePreviewReady(container: HTMLDivElement, expected: string, message: string) {
  const workspaceProof = container.querySelector('[data-testid="negative-lab-workspace-proof"]');
  const previewReady = workspaceProof?.getAttribute('data-preview-ready');
  if (previewReady !== expected) {
    throw new Error(`${message} Got ${previewReady ?? '<missing>'}.`);
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function installDom() {
  const window = new Window({ pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, {
    Blob: window.Blob,
    document: window.document,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLImageElement: window.HTMLImageElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement,
    MouseEvent: window.MouseEvent,
    navigator: window.navigator,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    URL: window.URL,
    window,
  });
}

async function flushTimers() {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

async function createTestI18n(resources: typeof locale) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: resources } },
  });
  return instance;
}
