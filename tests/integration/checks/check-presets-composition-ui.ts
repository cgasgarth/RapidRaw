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
import {
  BUILT_IN_COLOR_STYLE_PRESETS,
  COLOR_STYLE_PRESET_CATALOG,
} from '../../../src/utils/color/style/colorStylePresetCatalog';

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

const { PresetsPanel } = await import('../../../src/components/panel/right/color/PresetsPanel');

await validateEmptyStateWithoutBuiltInStyles();
await validateDiscoveryPreviewApplyAndRevert();
await validateLoadFailure();

if (failures.length > 0) {
  console.error('presets rendered behavior coverage failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('presets rendered behavior coverage ok');

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
    assertVisibleText(rendered.container, 'Get Community Presets', 'empty presets community action was not rendered.');

    rendered.unmount();
  } finally {
    BUILT_IN_COLOR_STYLE_PRESETS.splice(0, BUILT_IN_COLOR_STYLE_PRESETS.length, ...originalBuiltIns);
  }
}

async function validateDiscoveryPreviewApplyAndRevert() {
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

  await waitForText(rendered.container, 'User Portrait Style', 'root user preset was not rendered.');

  previewResolvers.forEach((resolve) => resolve(new Uint8Array([1, 2, 3, 4])));
  previewResolvers = [];

  assertVisibleText(rendered.container, 'Travel Folder', 'preset folder was not rendered.');

  const presetButton = getByTestId(rendered.container, 'preset-result-user-style-root').querySelector('button');
  assert.ok(presetButton, 'user preset selection button was not rendered.');
  await act(async () => {
    presetButton.click();
    await flushPromises();
  });
  assertVisibleText(
    rendered.container,
    'Selected User Portrait Style',
    'selecting a preset did not remain non-destructive.',
  );
  assert.equal(useEditorStore.getState().adjustments.temperature, INITIAL_ADJUSTMENTS.temperature);

  await act(async () => {
    presetButton.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await flushPromises();
  });
  await waitForText(rendered.container, 'Applied User Portrait Style', 'keyboard apply status was not rendered.');
  assert.equal(useEditorStore.getState().adjustments.temperature, 2);

  await act(async () => {
    useEditorStore.getState().setEditor({
      adjustments: { ...useEditorStore.getState().adjustments, exposure: 1.25 },
    });
    await flushPromises();
  });
  await waitForText(
    rendered.container,
    'Applied User Portrait Style then edited',
    'edited-after-apply state was not rendered.',
  );

  const revert = Array.from(rendered.container.querySelectorAll('button')).find(
    (button) => normalizeText(button.textContent) === 'Revert',
  );
  assert.ok(revert, 'revert action was not rendered after apply.');
  await act(async () => {
    revert.click();
    await flushPromises();
  });
  assert.equal(useEditorStore.getState().adjustments.temperature, INITIAL_ADJUSTMENTS.temperature);
  assert.equal(useEditorStore.getState().adjustments.exposure, INITIAL_ADJUSTMENTS.exposure);

  const filter = rendered.container.querySelector<HTMLSelectElement>('select[aria-label="Filter presets"]');
  assert.ok(filter, 'preset filter was not rendered.');
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    valueSetter?.call(filter, 'tool');
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
  });
  await waitForText(
    rendered.container,
    'No presets match this search or filter.',
    'empty search state was not rendered.',
  );

  rendered.unmount();
}

async function validateLoadFailure() {
  const rendered = await renderPanel({
    invoke: (command) => {
      if (command === Invokes.LoadPresets) throw new Error('disk unavailable');
      return [];
    },
    selectedReady: false,
  });

  await waitForText(rendered.container, 'Presets could not be loaded.', 'preset load failure was not rendered.');
  assertVisibleText(rendered.container, 'Retry', 'preset load retry action was not rendered.');
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
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: window.KeyboardEvent });
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

function assertVisibleText(container: Element, text: string, message: string) {
  if (!normalizeText(container.textContent).includes(text)) failures.push(message);
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
