#!/usr/bin/env bun

import { mock } from 'bun:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Panel, type Preset } from '../../../src/components/ui/AppProperties';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext';
import type { UserPreset } from '../../../src/hooks/editor/usePresets';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { useUIStore } from '../../../src/store/useUIStore';
import { Invokes } from '../../../src/tauri/commands';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { BUILT_IN_COLOR_STYLE_PRESETS, COLOR_STYLE_PRESET_CATALOG } from '../../../src/utils/colorStylePresetCatalog';

type RenderedPanel = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
};

type InvokeHandler = (command: string) => unknown | Promise<unknown>;

const failures: string[] = [];
let invokeHandler: InvokeHandler = () => {
  throw new Error('invoke handler was not installed.');
};

mock.module('@tauri-apps/api/core', () => ({
  invoke: (command: string) => invokeHandler(command),
}));
mock.module('@tauri-apps/plugin-dialog', () => ({
  open: () => null,
  save: () => null,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const { PresetsPanel } = await import('../../../src/components/panel/right/PresetsPanel');

await validateLocaleContract();
await validateEmptyStateWithoutBuiltInStyles();
await validateRenderedBuiltInAndUserComposition();

if (failures.length > 0) {
  console.error('presets rendered behavior coverage failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('presets rendered behavior coverage ok');

async function validateLocaleContract() {
  const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')) as {
    editor?: { presets?: { colorStyles?: Record<string, string>; composition?: Record<string, string> } };
  };

  const colorStyleKeys = [
    'adjustmentCoverage_one',
    'adjustmentCoverage_other',
    'defaultBadge',
    'genericLegalNote',
    'genericSafeBadge',
    'legalNote',
    'userBadge',
  ];
  const compositionKeys = [
    'colorStyles_one',
    'colorStyles_other',
    'userPresets_one',
    'userPresets_other',
    'folders_one',
    'folders_other',
    'previewsGenerating',
    'previewsReady_one',
    'previewsReady_other',
  ];

  const missing = [
    ...colorStyleKeys
      .filter((key) => typeof locale.editor?.presets?.colorStyles?.[key] !== 'string')
      .map((key) => `missing color style locale: ${key}`),
    ...compositionKeys
      .filter((key) => typeof locale.editor?.presets?.composition?.[key] !== 'string')
      .map((key) => `missing composition locale: ${key}`),
  ];

  failures.push(...missing);
}

async function validateEmptyStateWithoutBuiltInStyles() {
  const originalBuiltIns = [...BUILT_IN_COLOR_STYLE_PRESETS];
  BUILT_IN_COLOR_STYLE_PRESETS.splice(0, BUILT_IN_COLOR_STYLE_PRESETS.length);

  try {
    const rendered = await renderPanel({
      invoke: (command) => {
        if (command === Invokes.LoadPresets) return [];
        return [];
      },
      selectedReady: false,
    });

    await waitForText(rendered.container, 'No presets saved yet.', 'empty presets copy was not rendered.');
    assertVisibleText(rendered.container, '0 styles', 'empty panel did not expose zero built-in color styles.');
    assertVisibleText(rendered.container, '0 user presets', 'empty panel did not expose zero user presets.');
    assertVisibleText(rendered.container, '0 folders', 'empty panel did not expose zero folders.');
    assertVisibleText(rendered.container, '0 previews', 'empty panel did not expose zero generated previews.');
    assertVisibleText(rendered.container, 'Get Community Presets', 'empty presets community action was not rendered.');

    rendered.unmount();
  } finally {
    BUILT_IN_COLOR_STYLE_PRESETS.splice(0, BUILT_IN_COLOR_STYLE_PRESETS.length, ...originalBuiltIns);
  }
}

async function validateRenderedBuiltInAndUserComposition() {
  let previewResolvers: Array<(value: Uint8Array) => void> = [];
  const rendered = await renderPanel({
    invoke: (command) => {
      if (command === Invokes.LoadPresets) return buildUserPresetFixtures();
      if (command === Invokes.GeneratePresetPreview) {
        return new Promise<Uint8Array>((resolve) => {
          previewResolvers.push(resolve);
        });
      }
      return null;
    },
    selectedReady: true,
  });

  await waitForText(rendered.container, '4 styles', 'built-in color style count was not rendered.');
  await waitForText(rendered.container, '2 user presets', 'user preset composition count was not rendered.');
  assertCompositionItem(rendered.container, '2 user presets');
  assertCompositionItem(rendered.container, '1 folder');
  assertCompositionItem(rendered.container, 'Previews building');

  assertVisibleText(rendered.container, 'Clean Skin Balance', 'default built-in color style was not rendered.');
  assertVisibleText(rendered.container, 'Default', 'default color style badge was not rendered.');
  assertVisibleText(rendered.container, 'Generic', 'generic-safe color style badge was not rendered.');
  assertVisibleText(
    rendered.container,
    'Generic RawEngine recipe. No manufacturer, film-stock, official, or exact-emulation claim.',
    'generic-safe legal note was not rendered.',
  );
  assertVisibleText(rendered.container, '5 adjustments', 'built-in adjustment coverage count was not rendered.');

  await waitForText(rendered.container, 'User Portrait Style', 'root user preset was not rendered.');
  assertVisibleText(rendered.container, 'User', 'user style provenance badge was not rendered.');
  assertVisibleText(
    rendered.container,
    'User-created style. Naming and source stay user supplied; RawEngine does not claim an official or exact emulation.',
    'user style legal note was not rendered.',
  );
  assertData(
    getByTestId(rendered.container, 'user-color-style-provenance-user-style-root'),
    'colorStyleProvenanceSource',
    'user_created',
    'user style provenance source was not exposed.',
  );
  assertData(
    getByTestId(rendered.container, 'user-color-style-provenance-user-style-root'),
    'colorStyleLegalWarning',
    'User-created fixture legal warning.',
    'user style legal warning was not exposed.',
  );

  previewResolvers.forEach((resolve) => resolve(new Uint8Array([1, 2, 3, 4])));
  previewResolvers = [];
  await waitForText(rendered.container, '1 preview', 'generated root preview count was not rendered.');
  const preview = rendered.container.querySelector<HTMLImageElement>('img[alt="User Portrait Style preview"]');
  if (preview === null || !preview.src.startsWith('blob:rawengine-presets-panel-')) {
    failures.push('generated preview image did not render with the expected preview URL.');
  }

  assertVisibleText(rendered.container, 'Travel Folder', 'preset folder was not rendered.');

  rendered.unmount();
}

async function renderPanel(options: { invoke: InvokeHandler; selectedReady: boolean }): Promise<RenderedPanel> {
  invokeHandler = options.invoke;
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    selectedImage: options.selectedReady
      ? {
          exif: { ISO: '100' },
          height: 3000,
          isRaw: true,
          isReady: true,
          originalUrl: 'blob:rawengine-original',
          path: '/photos/presets-panel.ARW',
          thumbnailUrl: 'blob:rawengine-thumbnail',
          width: 4500,
        }
      : null,
  });
  useUIStore.getState().setUI({ activeRightPanel: Panel.Presets, renderedRightPanel: Panel.Presets });

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          ContextMenuProvider,
          null,
          createElement(PresetsPanel, {
            onNavigateToCommunity: () => undefined,
          }),
        ),
      ),
    );
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

function buildUserPresetFixtures(): Array<UserPreset> {
  return [
    {
      folder: {
        id: 'travel-folder',
        name: 'Travel Folder',
        children: [
          buildPreset('folder-film-style', 'Folder Film Style', {
            exposure: 0.2,
            contrast: 8,
          }),
        ],
      },
    },
    {
      preset: buildPreset(
        'user-style-root',
        'User Portrait Style',
        {
          temperature: 2,
          tint: 1,
          vibrance: 12,
        },
        {
          createdAt: '2026-06-01T00:00:00.000Z',
          legalNamingStatus: 'user_named',
          legalWarning: 'User-created fixture legal warning.',
          source: 'user_created',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ),
    },
  ];
}

function buildPreset(
  id: string,
  name: string,
  adjustments: Preset['adjustments'],
  colorStyleProvenance?: Preset['colorStyleProvenance'],
): Preset {
  return {
    adjustments,
    colorStyleProvenance,
    id,
    includeCropTransform: false,
    includeMasks: false,
    name,
    presetType: 'style',
  };
}

async function createTestI18n() {
  const resources = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    resources: { en: { translation: resources } },
  });
  return instance;
}

function installDom() {
  const window = new Window({ url: 'http://localhost/presets-panel-coverage' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: window.HTMLButtonElement });
  Object.defineProperty(globalThis, 'HTMLImageElement', { configurable: true, value: window.HTMLImageElement });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: window.Event });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: window.MouseEvent });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: window.Node });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: window.MutationObserver });
  Object.defineProperty(globalThis, 'PointerEvent', { configurable: true, value: window.PointerEvent ?? window.Event });
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    value: () => `blob:rawengine-presets-panel-${crypto.randomUUID()}`,
  });
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
  Object.defineProperty(COLOR_STYLE_PRESET_CATALOG, 'defaultPresetId', {
    configurable: true,
    value: 'color_style.portrait.clean_skin.v1',
  });
}

async function waitForText(container: Element, text: string, message: string) {
  await waitForCondition(message, () => normalizeText(container.textContent).includes(text));
}

async function waitForCondition(message: string, check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (check()) return;
    await act(async () => {
      await flushPromises();
    });
  }

  failures.push(message);
}

function assertCompositionItem(container: Element, text: string) {
  const summary = getByTestId(container, 'presets-composition-summary');
  const item = Array.from(summary.querySelectorAll('[data-presets-composition-item]')).find((element) =>
    normalizeText(element.textContent).includes(text),
  );
  if (item === undefined) failures.push(`composition item was not rendered: ${text}`);
}

function assertVisibleText(container: Element, text: string, message: string) {
  if (!normalizeText(container.textContent).includes(text)) failures.push(message);
}

function assertData(element: HTMLElement, key: string, expected: string, message: string) {
  const actual = element.dataset[key];
  if (actual !== expected) failures.push(`${message} Expected ${expected}, got ${actual ?? '<missing>'}.`);
}

function getByTestId<T extends HTMLElement = HTMLElement>(container: Element, testId: string): T {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  assert.ok(element, `missing test id: ${testId}`);
  return element as T;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
