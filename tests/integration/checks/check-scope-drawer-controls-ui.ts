#!/usr/bin/env bun

import { mock } from 'bun:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { Invokes } from '../../../src/tauri/commands.ts';

type RenderedPanel = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
};

type InvokeCall = {
  args: Record<string, unknown>;
  command: string;
};

const failures: string[] = [];
const invokeCalls: InvokeCall[] = [];

mock.module('@tauri-apps/api/core', () => ({
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    invokeCalls.push({ args, command });
    return null;
  },
}));
mock.module('@tauri-apps/plugin-os', () => ({
  platform: () => 'macos',
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const { default: InspectorAnalyticsHeader } = await import(
  '../../../src/components/panel/right/inspector/InspectorAnalyticsHeader.tsx'
);
const { Panel, Theme } = await import('../../../src/components/ui/AppProperties.tsx');
const { useEditorStore } = await import('../../../src/store/useEditorStore.ts');
const { useUIStore } = await import('../../../src/store/useUIStore.ts');
const { useSettingsStore } = await import('../../../src/store/useSettingsStore.ts');
const { DisplayMode, INITIAL_ADJUSTMENTS } = await import('../../../src/utils/adjustments.ts');
const { PANEL_SCOPES_HEIGHT } = await import('../../../src/utils/waveformSizing.ts');

await validateLocaleContract();
await validateScopeDrawerControls();

if (failures.length > 0) {
  console.error('scope drawer controls UI failed');
  console.error(failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log('scope drawer controls UI ok');

async function validateLocaleContract() {
  const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
  for (const key of ['layoutOverlay', 'layoutStacked', 'mode', 'resetHeight']) {
    if (typeof locale.ui?.waveform?.drawerControls?.[key] !== 'string') {
      failures.push(`missing locale key: ui.waveform.drawerControls.${key}`);
    }
  }
}

async function validateScopeDrawerControls() {
  useEditorStore.getState().setEditor({
    activeWaveformChannel: DisplayMode.Luma,
    adjustments: { ...INITIAL_ADJUSTMENTS, showClipping: false },
    histogram: {
      blue: { color: '#4D96FF', data: [0, 1, 0] },
      green: { color: '#6BCB77', data: [0, 1, 0] },
      luma: { color: '#FFFFFF', data: [0, 1, 0] },
      red: { color: '#FF6B6B', data: [0, 1, 0] },
    },
    isWaveformVisible: true,
    panelScopesLayout: 'stacked',
    previewScopeStatus: {
      displayTransformLabel: 'Display P3',
      exportProfileLabel: null,
      exportRenderingIntentLabel: null,
      histogramReady: true,
      path: '/analytics.ARW',
      renderBasis: 'editor_preview',
      softProofTransformApplied: false,
      sourceLabel: 'Editor preview',
      updatedAt: '2026-07-10T12:00:00.000Z',
      waveformReady: true,
      workingTransformLabel: 'Working RGB',
      warningCodes: [],
    },
    selectedImage: {
      exif: null,
      height: 3000,
      isRaw: true,
      isReady: true,
      metadata: null,
      originalUrl: null,
      path: '/analytics.ARW',
      rawDevelopmentReport: null,
      thumbnailUrl: 'data:image/jpeg;base64,AAAA',
      width: 4000,
    },
    waveformHeight: PANEL_SCOPES_HEIGHT.max,
  });
  useSettingsStore.getState().setAppSettings({
    activeWaveformChannel: DisplayMode.Luma,
    lastRootPath: null,
    panelScopesLayout: 'stacked',
    theme: Theme.Dark,
    waveformHeight: PANEL_SCOPES_HEIGHT.max,
  });

  const rendered = await renderPanel();
  const strip = getByTestId(rendered.container, 'scope-drawer-under-test');
  assert.equal(strip.getAttribute('data-active-waveform-channel'), DisplayMode.Luma);
  assert.equal(strip.getAttribute('data-panel-scopes-layout'), 'stacked');
  assert.equal(strip.getAttribute('data-show-clipping'), 'false');
  assert.equal(strip.getAttribute('data-analytics-state'), 'current');
  assert.equal(strip.getAttribute('data-panel-scopes-height'), String(PANEL_SCOPES_HEIGHT.max));

  await click(getByTestId(rendered.container, 'scope-drawer-under-test-mode-parade'));
  assert.equal(useEditorStore.getState().activeWaveformChannel, DisplayMode.Parade);
  assert.equal(strip.getAttribute('data-active-waveform-channel'), DisplayMode.Parade);

  await keyDown(getByTestId(rendered.container, 'scope-drawer-under-test-mode-parade'), 'ArrowRight');
  assert.equal(useEditorStore.getState().activeWaveformChannel, DisplayMode.Vectorscope);

  await click(getByTestId(rendered.container, 'scope-drawer-under-test-shadow-clipping-toggle'));
  assert.equal(useEditorStore.getState().adjustments.showClipping, true);
  assert.equal(strip.getAttribute('data-show-clipping'), 'true');
  await click(getByTestId(rendered.container, 'scope-drawer-under-test-highlight-clipping-toggle'));
  assert.equal(useEditorStore.getState().adjustments.showClipping, false);

  await click(getByTestId(rendered.container, 'scope-drawer-under-test-layout-toggle'));
  assert.equal(useEditorStore.getState().panelScopesLayout, 'overlay');
  assert.equal(strip.getAttribute('data-panel-scopes-layout'), 'overlay');

  await click(getByTestId(rendered.container, 'scope-drawer-under-test-reset-height'));
  assert.equal(useEditorStore.getState().waveformHeight, PANEL_SCOPES_HEIGHT.default);
  assert.equal(strip.getAttribute('data-panel-scopes-height'), String(PANEL_SCOPES_HEIGHT.default));

  const settingsSaves = invokeCalls.filter((call) => call.command === Invokes.SaveSettings);
  const savedChannel = settingsSaves.find((call) => {
    const settings = call.args.settings as { activeWaveformChannel?: string } | undefined;
    return settings?.activeWaveformChannel === DisplayMode.Parade;
  });
  const savedLayout = settingsSaves.find((call) => {
    const settings = call.args.settings as { panelScopesLayout?: string } | undefined;
    return settings?.panelScopesLayout === 'overlay';
  });
  const savedHeight = settingsSaves.find((call) => {
    const settings = call.args.settings as { waveformHeight?: number } | undefined;
    return settings?.waveformHeight === PANEL_SCOPES_HEIGHT.default;
  });
  assert.ok(savedChannel, 'channel control did not persist the active scope mode.');
  assert.ok(savedLayout, 'layout control did not persist the drawer layout.');
  assert.ok(savedHeight, 'reset height control did not persist the default height.');

  await act(async () => {
    useEditorStore.getState().setEditor((state) => ({
      previewScopeStatus: state.previewScopeStatus
        ? { ...state.previewScopeStatus, path: '/stale.ARW' }
        : state.previewScopeStatus,
    }));
    await flushPromises();
  });
  assert.equal(strip.getAttribute('data-analytics-state'), 'stale');
  assert.equal(
    getByTestId(rendered.container, 'scope-drawer-under-test-freshness-status').getAttribute('aria-live'),
    'polite',
  );

  await act(async () => {
    useEditorStore.getState().setEditor((state) => ({
      previewScopeStatus: state.previewScopeStatus
        ? { ...state.previewScopeStatus, warningCodes: ['scope_render_failed'] }
        : state.previewScopeStatus,
    }));
    await flushPromises();
  });
  assert.equal(strip.getAttribute('data-analytics-state'), 'error');

  await act(async () => {
    useUIStore.getState().setRightPanel(Panel.Adjustments);
    await flushPromises();
  });
  await click(getByTestId(rendered.container, 'scope-drawer-under-test-proof-status'));
  assert.equal(useUIStore.getState().activeRightPanel, Panel.Color);
  assert.equal(window.sessionStorage.getItem('rawengine.colorWorkspace.activeTab'), 'output');

  await click(getByTestId(rendered.container, 'scope-drawer-under-test-expand-toggle'));
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(strip.getAttribute('data-state'), 'collapsed');
  assert.ok(getByTestId(rendered.container, 'scope-drawer-under-test-summary'));

  rendered.unmount();
}

async function renderPanel(): Promise<RenderedPanel> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(InspectorAnalyticsHeader, {
          testId: 'scope-drawer-under-test',
        }),
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

function installDom() {
  const window = new Window({ url: 'http://localhost/scope-drawer-controls-ui' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: window.HTMLButtonElement });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: window.MouseEvent });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: window.Event });
  Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: window.CustomEvent });
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: window.KeyboardEvent });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: window.Node });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: window.MutationObserver });
  Object.defineProperty(globalThis, 'PointerEvent', { configurable: true, value: window.PointerEvent ?? window.Event });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16),
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: (id: number) => window.clearTimeout(id),
  });
}

async function createTestI18n() {
  const resources = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: resources } },
  });
  return instance;
}

function getByTestId<T extends Element>(container: Element, testId: string): T {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  assert.ok(element, `missing test id: ${testId}`);
  return element as T;
}

async function click(element: Element) {
  await act(async () => {
    if (element instanceof HTMLButtonElement) {
      element.click();
    } else {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    await flushPromises();
  });
}

async function keyDown(element: Element, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
    await flushPromises();
  });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
