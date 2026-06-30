#!/usr/bin/env bun

import { mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import type { SelectedImage } from '../../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';

type RenderedHarness = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
};

const failures: string[] = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const autoAdjustments = {
  ...structuredClone(INITIAL_ADJUSTMENTS),
  brightness: 12,
  contrast: 18,
  exposure: 0.35,
} satisfies Adjustments;

mock.module('@tauri-apps/api/core', () => ({
  invoke: async () => structuredClone(autoAdjustments),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const { default: EditorToolbar } = await import('../../../../src/components/panel/editor/EditorToolbar.tsx');
const { useEditorActions } = await import('../../../../src/hooks/editor/useEditorActions.ts');

const i18n = await createTestI18n(locale);
const rendered = await renderHarness();
const undoLabel = locale.editor?.toolbar?.tooltips?.undo ?? 'Undo';

assertDisabledState(rendered.container, undoLabel, true, 'undo should begin disabled before auto adjust');
await act(async () => {
  rendered.container.querySelector<HTMLButtonElement>('[data-testid="apply-auto-adjust"]')?.click();
  await flushPromises();
});

assertDisabledState(rendered.container, undoLabel, false, 'undo should enable immediately after auto adjust');
assertHistoryState();

rendered.unmount();

if (failures.length > 0) {
  console.error('editor auto-adjust history state failed');
  console.error(failures.slice(0, 10).join('\n'));
  process.exit(1);
}

console.log('editor auto-adjust history state ok');

async function renderHarness(): Promise<RenderedHarness> {
  useEditorStore.getState().resetHistory(structuredClone(INITIAL_ADJUSTMENTS));
  useEditorStore.getState().setEditor({
    adjustments: structuredClone(INITIAL_ADJUSTMENTS),
    selectedImage: createSelectedImage(),
  });

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(AutoAdjustHarness, {})));
    await flushPromises();
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

function AutoAdjustHarness() {
  const { handleAutoAdjustments } = useEditorActions();
  const adjustmentsHistory = useEditorStore((state) => state.history);
  const adjustmentsHistoryIndex = useEditorStore((state) => state.historyIndex);
  const selectedImage = useEditorStore((state) => state.selectedImage);

  return createElement(
    'div',
    {},
    createElement(
      'button',
      {
        'data-testid': 'apply-auto-adjust',
        onClick: () => {
          void handleAutoAdjustments();
        },
        type: 'button',
      },
      'Apply auto adjust',
    ),
    createElement(EditorToolbar, {
      adjustmentsHistory,
      adjustmentsHistoryIndex,
      canRedo: adjustmentsHistoryIndex < adjustmentsHistory.length - 1,
      canUndo: adjustmentsHistoryIndex > 0,
      goToAdjustmentsHistoryIndex: () => undefined,
      isAndroid: false,
      isLoading: false,
      onBackToLibrary: () => undefined,
      onRedo: () => undefined,
      onToggleDateView: () => undefined,
      onToggleFullScreen: () => undefined,
      onToggleShowOriginal: () => undefined,
      onUndo: () => undefined,
      selectedImage: selectedImage ?? createSelectedImage(),
      showDateView: false,
      showOriginal: false,
      osPlatform: 'linux',
    }),
  );
}

function assertDisabledState(container: HTMLElement, label: string, expected: boolean, message: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) {
    failures.push(`missing button: ${label}`);
    return;
  }

  if (button.disabled !== expected) {
    failures.push(message);
  }
}

function assertHistoryState() {
  const state = useEditorStore.getState();
  if (state.historyIndex !== 1) failures.push(`expected history index 1 after auto adjust, got ${state.historyIndex}`);
  if (state.history.length !== 2)
    failures.push(`expected 2 history entries after auto adjust, got ${state.history.length}`);
  if (state.adjustments.contrast !== autoAdjustments.contrast) {
    failures.push('auto adjust values were not applied to the editor state');
  }
}

function createSelectedImage(): SelectedImage {
  return {
    exif: null,
    height: 3024,
    isRaw: true,
    isReady: true,
    originalUrl: null,
    path: '/library/history/auto-adjust.ARW',
    thumbnailUrl: 'data:image/png;base64,',
    width: 4032,
  };
}

function installDom() {
  const window = new Window({ pretendToBeVisual: true });
  const { document } = window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: window,
  });
  globalThis.document = document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.navigator = window.navigator;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
