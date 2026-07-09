#!/usr/bin/env bun

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { type AppSettings, Theme } from '../../../../src/components/ui/AppProperties';
import { useEditorStore } from '../../../../src/store/useEditorStore';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments';

type RenderedPanel = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
};

type AdjustmentUpdate = Partial<Adjustments> | ((previous: Adjustments) => Adjustments);

const appSettingsFixture = {
  exportPresets: [],
  lastRootPath: null,
  theme: Theme.Dark,
  useWgpuRenderer: true,
} satisfies AppSettings;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const { default: ColorPanel } = await import('../../../../src/components/adjustments/Color');
const rendered = await renderColorPanel();

try {
  await validateKeyboardWorkspaceNavigation(rendered.container);
  await selectEditorWorkspace(rendered.container);
  await validateCompactEditorSurface(rendered.container);
  await validateDirectProfileToneSelection(rendered.container);
  await validateProgressiveMixerDisclosure(rendered.container);
  await validateHslSurfaceInteraction(rendered.container);
} finally {
  rendered.unmount();
}

console.log('color inspector compact workflow coverage ok');

async function renderColorPanel(): Promise<RenderedPanel> {
  useEditorStore.getState().setEditor({
    exportSoftProofRecipeId: null,
    exportSoftProofTransform: null,
    gamutWarningOverlay: null,
    isExportSoftProofEnabled: false,
    isGamutWarningOverlayVisible: false,
    previewScopeStatus: null,
    selectedImage: null,
  });

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(TestColorHarness, {
          appSettings: appSettingsFixture,
          initialAdjustments: structuredClone(INITIAL_ADJUSTMENTS),
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

function TestColorHarness({
  appSettings,
  initialAdjustments,
}: {
  appSettings: AppSettings;
  initialAdjustments: Adjustments;
}) {
  const [adjustments, setAdjustmentState] = useState(initialAdjustments);
  const setAdjustments = (update: AdjustmentUpdate) => {
    setAdjustmentState((previous) => (typeof update === 'function' ? update(previous) : { ...previous, ...update }));
  };

  return createElement(ColorPanel, {
    adjustments,
    appSettings,
    onDragStateChange: () => undefined,
    setAdjustments,
  });
}

async function selectEditorWorkspace(container: Element) {
  await click(getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-editor'));
  assert.equal(
    getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-editor').getAttribute('aria-selected'),
    'true',
    'Editor workspace should be selected.',
  );
}

async function validateKeyboardWorkspaceNavigation(container: Element) {
  const tablist = getByTestId<HTMLDivElement>(container, 'color-workspace-tabs');
  const editor = getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-editor');

  await act(async () => {
    tablist.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));
    await flushPromises();
  });
  assert.equal(editor.getAttribute('aria-selected'), 'true', 'ArrowRight should select Editor from Quick.');
  assert.equal(document.activeElement, editor, 'ArrowRight should focus the selected workspace.');
}

async function validateCompactEditorSurface(container: Element) {
  const profileTone = getByTestId(container, 'profile-tone-controls');
  const colorMixer = getByTestId(container, 'color-mixer-controls');
  const hslControls = getByTestId(container, 'selective-color-range-controls');
  const localRangeDisclosure = getByTestId<HTMLDetailsElement>(container, 'local-color-range-adjustment-disclosure');
  const balanceDisclosure = getByTestId<HTMLDetailsElement>(container, 'color-balance-disclosure');
  const channelDisclosure = getByTestId<HTMLDetailsElement>(container, 'channel-mixer-disclosure');
  const blackWhiteDisclosure = getByTestId<HTMLDetailsElement>(container, 'black-white-mixer-disclosure');

  assert.equal(profileTone.querySelectorAll('select').length, 2, 'Profile & Tone should expose two direct selectors.');
  assert.equal(
    hslControls.compareDocumentPosition(balanceDisclosure) & Node.DOCUMENT_POSITION_FOLLOWING,
    Node.DOCUMENT_POSITION_FOLLOWING,
    'HSL controls should lead the Editor workspace.',
  );
  assert.equal(colorMixer.className.includes('rounded'), false, 'Color Mixer should not be framed as a card.');
  assert.equal(container.querySelector('[data-testid="color-workspace-warning-chips"]'), null);
  assert.equal(container.querySelector('[data-testid="professional-color-recipes-disclosure"]'), null);
  assert.equal(container.querySelector('[data-testid="selective-color-mask-preview-toggle"]'), null);

  for (const label of ['Hue', 'Saturation', 'Luminance']) {
    assert.ok(getRangeByLabel(container, label), `Primary HSL slider was not rendered: ${label}.`);
  }
  assert.equal(localRangeDisclosure.dataset.scope, 'local-adjustment');
  for (const disclosure of [localRangeDisclosure, balanceDisclosure, channelDisclosure, blackWhiteDisclosure]) {
    assert.equal(disclosure.open, false, 'Secondary color tools should start collapsed.');
  }
}

async function validateDirectProfileToneSelection(container: Element) {
  const controls = getByTestId(container, 'profile-tone-controls');
  const selects = controls.querySelectorAll<HTMLSelectElement>('select');
  const profile = selects[0];
  const toneCurve = selects[1];
  assert.ok(profile, 'Camera Profile selector was not rendered.');
  assert.ok(toneCurve, 'Tone Curve selector was not rendered.');

  await changeSelect(profile, 'camera_portrait');
  await changeSelect(toneCurve, 'soft_contrast');
  assert.equal(controls.dataset.cameraProfile, 'camera_portrait', 'Profile selector did not apply the selected value.');
  assert.equal(controls.dataset.toneCurve, 'soft_contrast', 'Tone Curve selector did not apply the selected value.');
}

async function validateProgressiveMixerDisclosure(container: Element) {
  await validateMixerToggle(container, 'color-balance-toggle', 'color-balance-disclosure', 'color-balance-controls');
  await validateMixerToggle(container, 'channel-mixer-toggle', 'channel-mixer-disclosure', 'channel-mixer-controls');
  await validateMixerToggle(
    container,
    'black-white-mixer-toggle',
    'black-white-mixer-disclosure',
    'black-white-mixer-controls',
  );
}

async function validateMixerToggle(
  container: Element,
  toggleTestId: string,
  disclosureTestId: string,
  controlsTestId: string,
) {
  const toggle = getByTestId<HTMLButtonElement>(container, toggleTestId);
  const disclosure = getByTestId<HTMLDetailsElement>(container, disclosureTestId);
  assert.equal(toggle.getAttribute('aria-pressed'), 'false', `${toggleTestId} should start Off.`);
  assert.equal(normalizeText(toggle.textContent), 'Off', `${toggleTestId} should label its inactive state.`);
  assert.equal(
    container.querySelector(`[data-testid="${controlsTestId}"]`),
    null,
    `${controlsTestId} should stay hidden while Off.`,
  );

  await click(toggle);
  assert.equal(toggle.getAttribute('aria-pressed'), 'true', `${toggleTestId} should expose its active state.`);
  assert.equal(normalizeText(toggle.textContent), 'On', `${toggleTestId} should label its active state.`);
  assert.equal(disclosure.open, true, `${toggleTestId} should reveal controls when enabled.`);
  assert.ok(
    container.querySelector(`[data-testid="${controlsTestId}"]`),
    `${controlsTestId} should render when enabled.`,
  );

  await click(toggle);
  assert.equal(toggle.getAttribute('aria-pressed'), 'false', `${toggleTestId} should return to Off.`);
  assert.equal(
    container.querySelector(`[data-testid="${controlsTestId}"]`),
    null,
    `${controlsTestId} should hide after disable.`,
  );
}

async function validateHslSurfaceInteraction(container: Element) {
  const hue = getRangeByLabel(container, 'Hue');
  assert.ok(hue, 'Hue slider was not rendered.');
  const hueValue = container.querySelector<HTMLButtonElement>('[aria-label="Hue value"]');
  assert.equal(normalizeText(hueValue?.textContent), '0', 'Hue should expose its direct numeric value.');

  await click(getByTestId<HTMLButtonElement>(container, 'selective-color-range-oranges'));
  assert.equal(
    getByTestId(container, 'selective-color-range-controls').dataset.dirty,
    'false',
    'Changing the active range should preserve the current range adjustment state.',
  );
  assert.equal(getByTestId(container, 'selective-color-range-controls').dataset.activeRange, 'oranges');
  assert.equal(normalizeText(getByTestId(container, 'selective-color-active-range-chip').textContent), 'Oranges');

  const localRangeDisclosure = getByTestId<HTMLDetailsElement>(container, 'local-color-range-adjustment-disclosure');
  const localRangeSummary = localRangeDisclosure.querySelector<HTMLElement>('summary');
  assert.ok(localRangeSummary, 'Local range disclosure summary was not rendered.');
  assert.equal(normalizeText(localRangeSummary.textContent).startsWith('Create local adjustment'), true);
  await click(localRangeSummary);
  const rangeCenter = getRangeByLabel(localRangeDisclosure, 'Range center');
  assert.ok(rangeCenter, 'Local range center slider was not rendered.');
  await changeRange(rangeCenter, 42);
  assert.equal(getByTestId<HTMLButtonElement>(container, 'selective-color-reset-active-range').disabled, true);
  assert.equal(getByTestId<HTMLButtonElement>(container, 'local-color-range-reset').disabled, false);

  await changeRange(hue, 8);
  await click(getByTestId<HTMLButtonElement>(container, 'selective-color-reset-active-range'));
  assert.equal(rangeCenter.value, '42', 'Resetting HSL must not reset the local mask range.');
  assert.equal(getByTestId<HTMLButtonElement>(container, 'local-color-range-reset').disabled, false);
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await flushPromises();
  });
}

async function changeSelect(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
  });
}

async function changeRange(input: HTMLInputElement, value: number) {
  await act(async () => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
  });
}

function getByTestId<T extends HTMLElement = HTMLElement>(container: Element, testId: string): T {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  assert.ok(element, `Missing test id: ${testId}.`);
  return element as T;
}

function getRangeByLabel(container: Element, label: string): HTMLInputElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLInputElement>('input[type="range"]')).find(
      (input) => input.getAttribute('aria-label') === label,
    ) ?? null
  );
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
  const window = new Window({ url: 'http://localhost/color-inspector-coverage' });
  window.sessionStorage.clear();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: window.HTMLButtonElement });
  Object.defineProperty(globalThis, 'HTMLDetailsElement', { configurable: true, value: window.HTMLDetailsElement });
  Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: window.HTMLInputElement });
  Object.defineProperty(globalThis, 'HTMLSelectElement', { configurable: true, value: window.HTMLSelectElement });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: window.Event });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: window.MouseEvent });
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: window.KeyboardEvent });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: window.Node });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: window.MutationObserver });
  Object.defineProperty(globalThis, 'PointerEvent', { configurable: true, value: window.PointerEvent ?? window.Event });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0),
  });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
  });
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
