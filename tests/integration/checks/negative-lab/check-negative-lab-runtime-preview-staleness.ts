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
const deferredCandidatePreviewA = createDeferred<string>();
const deferredCandidatePreviewB = createDeferred<string>();
const runtimePreviewRequests: Array<Record<string, unknown>> = [];

mock.module('@tauri-apps/api/core', () => ({
  invoke: mock((command: string, args?: Record<string, unknown>) => {
    if (command === Invokes.GeneratePreviewForPath) return Promise.resolve(new Uint8Array([1, 2, 3]));
    if (command === Invokes.PreviewNegativeConversion) {
      const path = typeof args?.path === 'string' ? args.path : '';
      if (path.includes('scan-a')) return deferredCandidatePreviewA.promise;
      if (path.includes('scan-b')) return deferredCandidatePreviewB.promise;
      throw new Error(`Unexpected candidate preview path: ${path}`);
    }
    if (command === Invokes.RenderNegativeLabDryRunPreviewArtifact) {
      runtimePreviewRequests.push(args ?? {});
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
const { useUIStore } = await import('../../../../src/store/useUIStore.ts');

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
  densityNormalizationMetrics: buildDensityNormalizationMetrics(),
  dimensions: { height: 1, width: 1 },
  previewDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==',
  renderer: 'rawengine_negative_lab_runtime_preview_v1',
  storage: 'temp_cache',
});
await act(async () => {
  await flushTimers();
});

assertWorkspacePreviewReady(rendered.container, 'false', 'Stale preview A must not mark workspace ready.');
deferredCandidatePreviewA.resolve('data:image/png;base64,Y2FuZGlkYXRlLWE=');
await act(async () => {
  await flushTimers();
});
if (rendered.container.querySelector('img[src="data:image/png;base64,Y2FuZGlkYXRlLWE="]') !== null) {
  throw new Error('A stale candidate-profile batch must not publish into the newer source session.');
}

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
  densityNormalizationMetrics: buildDensityNormalizationMetrics(),
  dimensions: { height: 1, width: 1 },
  previewDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==',
  renderer: 'rawengine_negative_lab_runtime_preview_v1',
  storage: 'temp_cache',
});
await act(async () => {
  await flushTimers();
});

assertWorkspacePreviewReady(rendered.container, 'true', 'Current preview B should mark workspace ready.');
deferredCandidatePreviewB.resolve('data:image/png;base64,Y2FuZGlkYXRlLWI=');
await act(async () => {
  await flushTimers();
});
if (rendered.container.querySelector('img[src="data:image/png;base64,Y2FuZGlkYXRlLWI="]') === null) {
  throw new Error('The current candidate-profile batch should publish into its owning source session.');
}

const acquisitionProfileSelect = rendered.container.querySelector(
  '[data-testid="negative-lab-acquisition-profile"]',
) as HTMLSelectElement | null;
if (acquisitionProfileSelect === null) throw new Error('Expected Negative Lab acquisition profile control.');
await act(async () => {
  acquisitionProfileSelect.value = 'scanner_rgb_jpeg_review_v1';
  acquisitionProfileSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  await flushTimers(180);
});
if (runtimePreviewRequests.length < 3) throw new Error('Expected a runtime preview request after profile selection.');
if (getKeyedSession(rendered.container).getAttribute('data-runtime-channel-basis') !== 'rendered_rgb') {
  throw new Error('Acquisition profile changes must preview the exact next-state profile snapshot.');
}
const blackAndWhitePresetButton = rendered.container.querySelector(
  '[data-testid="negative-lab-profile-comparison-use-negative_lab.generic.bw.classic.v1"]',
) as HTMLButtonElement | null;
if (blackAndWhitePresetButton === null) throw new Error('Expected a selectable black-and-white Negative Lab preset.');
await act(async () => {
  blackAndWhitePresetButton.click();
  await flushTimers(180);
});
if (
  getKeyedSession(rendered.container).getAttribute('data-runtime-process-family') !== 'black_and_white_silver_negative'
) {
  throw new Error('Preset changes must preview the exact next-state process-family snapshot.');
}

const proofBeforeReopen = getWorkspaceProof(rendered.container);
const compareButton = rendered.container.querySelector(
  '[data-testid="negative-lab-compare-control"]',
) as HTMLButtonElement | null;
if (compareButton === null) throw new Error('Expected Negative Lab compare control.');
await act(async () => {
  compareButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
});
if (getWorkspaceProof(rendered.container).getAttribute('data-compare-active') !== 'true') {
  throw new Error('Compare state should be active before same-path reopen.');
}

await act(async () => {
  useUIStore.setState((state) => ({
    negativeModalState: {
      ...state.negativeModalState,
      operationEpoch: state.negativeModalState.operationEpoch + 1,
      targetPaths: ['/roll/scan-b.dng'],
    },
  }));
  await flushTimers(350);
});
const proofAfterReopen = getWorkspaceProof(rendered.container);
if (proofAfterReopen.getAttribute('data-operation-id') === proofBeforeReopen.getAttribute('data-operation-id')) {
  throw new Error('Same-path reopen must create a new keyed operation identity.');
}
if (proofAfterReopen.getAttribute('data-compare-active') !== 'false') {
  throw new Error('Same-path reopen must synchronously initialize clean transient compare state.');
}
const reopenedCompareButton = rendered.container.querySelector(
  '[data-testid="negative-lab-compare-control"]',
) as HTMLButtonElement | null;
if (reopenedCompareButton === null) throw new Error('Expected reopened Negative Lab compare control.');
await act(async () => {
  reopenedCompareButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
});

await rerenderNegativeLabModal(rendered.root, ['/roll/scan-b.dng'], false);
const closingSession = rendered.container.querySelector('[data-testid="negative-lab-keyed-session"]');
if (closingSession === null) {
  throw new Error('Closing transition must retain the frozen keyed session until the shell exit completes.');
}
if (closingSession.getAttribute('data-compare-active') !== 'true') {
  throw new Error('Closing transition must freeze transient state instead of clearing it from an Effect.');
}
await act(async () => {
  await flushTimers(350);
});
if (rendered.container.querySelector('[data-testid="negative-lab-keyed-session"]') !== null) {
  throw new Error('Closing transition must dispose the keyed session without delayed ordinary-state resets.');
}

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

async function rerenderNegativeLabModal(root: Root, targetPaths: string[], isOpen = true) {
  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(NegativeConversionModal, {
          isOpen,
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
  const workspaceProof = getWorkspaceProof(container);
  const previewReady = workspaceProof?.getAttribute('data-preview-ready');
  if (previewReady !== expected) {
    throw new Error(`${message} Got ${previewReady ?? '<missing>'}.`);
  }
}

function getWorkspaceProof(container: HTMLDivElement): HTMLElement {
  const workspaceProof = container.querySelector('[data-testid="negative-lab-workspace-proof"]');
  if (!(workspaceProof instanceof HTMLElement)) throw new Error('Expected Negative Lab workspace proof.');
  return workspaceProof;
}

function getKeyedSession(container: HTMLDivElement): HTMLElement {
  const session = container.querySelector('[data-testid="negative-lab-keyed-session"]');
  if (!(session instanceof HTMLElement)) throw new Error('Expected keyed Negative Lab session.');
  return session;
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

function buildDensityNormalizationMetrics() {
  return {
    axisBounds: {
      color: { max: 0.12, min: -0.12 },
      luma: { max: 1.02, min: -0.03 },
    },
    channelBounds: {
      b: { max: 1.07, min: -0.02 },
      g: { max: 1.01, min: -0.01 },
      r: { max: 0.96, min: 0 },
    },
    clippedPixelCount: 0,
    densityRangeUnclamped: 1.09,
    epsilonClampedPixelCount: 0,
    rendererVersion: 2,
  };
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

async function flushTimers(delayMs = 40) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
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
