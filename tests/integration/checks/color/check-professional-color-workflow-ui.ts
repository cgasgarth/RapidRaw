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
import {
  COLOR_OUTPUT_FOCUS_EVENT,
  COLOR_WORKSPACE_TAB_SESSION_KEY,
} from '../../../../src/utils/colorWorkspaceNavigation';

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
  useWgpuRenderer: false,
} satisfies AppSettings;

const rawDevelopmentReportFixture = {
  cameraProfile: {
    algorithmId: 'rawengine.camera-profile.v1',
    candidateCount: 0,
    fallbackReason: 'No matching measured input profile',
    illuminantEstimateConfidence: 'low' as const,
    illuminantEstimateMethod: 'fallback' as const,
    status: 'fallback' as const,
    warningCodes: ['profile_fallback'],
  },
  demosaicPath: 'bayer_hq' as const,
  highlightReconstruction: {
    algorithmId: 'sensor_linear_confidence_hierarchy_v2' as const,
    cfaKind: 'bayer' as const,
    clippedSamples: 0,
    confidencePercentiles: [0, 0, 0, 0, 0] as const,
    implementationVersion: 2 as const,
    invalidSamples: 0,
    largestClippedRegion: 0,
    methodCounts: {},
    mode: 'auto' as const,
    nearClippedSamples: 0,
    partiallyReconstructedSamples: 0,
    postDemosaicFallbackSamples: 0,
    reconstructedSamples: 0,
    unrecoverableSamples: 0,
    warningCodes: [],
  },
  processingProfile: 'balanced' as const,
};

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const { default: ColorPanel } = await import('../../../../src/components/adjustments/Color');
const rendered = await renderColorPanel();

try {
  await validateFoundationHierarchy(rendered.container);
  await validateDirectProfileToneSelection(rendered.container);
  await validateWhiteBalanceFoundation(rendered.container);
  await validateKeyboardWorkspaceNavigation(rendered.container);
  await selectMixerWorkspace(rendered.container);
  await validateCompactMixerSurface(rendered.container);
  await validateHslSurfaceInteraction(rendered.container);
  await validateOutputFocusEvent(rendered.container, true);

  window.sessionStorage.setItem(COLOR_WORKSPACE_TAB_SESSION_KEY, 'output');
  const localRendered = await renderColorPanel(true);
  try {
    validateMaskLocalFiltering(localRendered.container);
    assert.equal(
      getByTestId(localRendered.container, 'color-workspace-tab-foundation').getAttribute('aria-selected'),
      'true',
      'Mask context must synchronously derive Foundation when the requested Output tab is unavailable.',
    );
    assert.equal(
      window.sessionStorage.getItem(COLOR_WORKSPACE_TAB_SESSION_KEY),
      'output',
      'A temporarily unavailable session preference should be retained until an explicit navigation request.',
    );
    const restoredRendered = await renderColorPanel();
    try {
      assert.equal(
        getByTestId(restoredRendered.container, 'color-workspace-tab-output').getAttribute('aria-selected'),
        'true',
        'Re-enabling Output should restore the retained session preference.',
      );
    } finally {
      restoredRendered.unmount();
    }
    await validateOutputFocusEvent(localRendered.container, false);
  } finally {
    localRendered.unmount();
  }
} finally {
  rendered.unmount();
}

async function validateOutputFocusEvent(container: Element, outputAvailable: boolean) {
  await act(async () => {
    window.dispatchEvent(new Event(COLOR_OUTPUT_FOCUS_EVENT));
    await flushPromises();
  });
  const expectedTab = outputAvailable ? 'output' : 'foundation';
  const tab = getByTestId<HTMLButtonElement>(container, `color-workspace-tab-${expectedTab}`);
  assert.equal(tab.getAttribute('aria-selected'), 'true', 'Output focus should select an available tab explicitly.');
  assert.equal(document.activeElement, tab, 'Output focus should focus the selected available tab.');
  assert.equal(
    window.sessionStorage.getItem(COLOR_WORKSPACE_TAB_SESSION_KEY),
    expectedTab,
    'Output focus must never persist an unavailable requested tab.',
  );
}

console.log('color inspector compact workflow coverage ok');

async function renderColorPanel(isForMask = false): Promise<RenderedPanel> {
  await act(async () => {
    useEditorStore.getState().setEditor({
      exportSoftProofRecipeId: null,
      exportSoftProofTransform: null,
      gamutWarningOverlay: null,
      isExportSoftProofEnabled: false,
      isGamutWarningOverlayVisible: false,
      previewScopeStatus: null,
      selectedImage: {
        exif: null,
        height: 3000,
        isRaw: true,
        isReady: true,
        originalUrl: 'blob:color-foundation-fixture',
        path: '/fixtures/color-foundation.raw',
        rawDevelopmentReport: rawDevelopmentReportFixture,
        thumbnailUrl: 'blob:color-foundation-thumbnail',
        width: 4500,
      },
    });
    await flushPromises();
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
          isForMask,
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
  isForMask,
}: {
  appSettings: AppSettings;
  initialAdjustments: Adjustments;
  isForMask: boolean;
}) {
  const [adjustments, setAdjustmentState] = useState(initialAdjustments);
  const [isWbPickerActive, setIsWbPickerActive] = useState(false);
  const setAdjustments = (update: AdjustmentUpdate) => {
    setAdjustmentState((previous) => (typeof update === 'function' ? update(previous) : { ...previous, ...update }));
  };

  return createElement(ColorPanel, {
    adjustments,
    appSettings,
    isForMask,
    isWbPickerActive,
    onDragStateChange: () => undefined,
    setAdjustments,
    toggleWbPicker: () => setIsWbPickerActive((active) => !active),
  });
}

async function selectMixerWorkspace(container: Element) {
  await click(getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-mixer'));
  assert.equal(
    getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-mixer').getAttribute('aria-selected'),
    'true',
    'Mixer workspace should be selected.',
  );
}

async function validateKeyboardWorkspaceNavigation(container: Element) {
  const tablist = getByTestId<HTMLDivElement>(container, 'color-workspace-tabs');
  const mixer = getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-mixer');

  await act(async () => {
    tablist.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));
    await flushPromises();
  });
  assert.equal(mixer.getAttribute('aria-selected'), 'true', 'ArrowRight should select Mixer from Foundation.');
  assert.equal(document.activeElement, mixer, 'ArrowRight should focus the selected workspace.');
}

function validateFoundationHierarchy(container: Element) {
  const foundation = getByTestId(container, 'color-foundation-controls');
  const profileTone = getByTestId(foundation, 'profile-tone-controls');
  const whiteBalance = getByTestId(foundation, 'color-quick-white-balance');
  const globalColor = getByTestId(foundation, 'color-quick-presence');
  const calibration = getByTestId<HTMLDetailsElement>(foundation, 'color-calibration-disclosure');

  assert.equal(getByTestId(container, 'color-workspace-tab-foundation').getAttribute('aria-selected'), 'true');
  assert.equal(profileTone.dataset.runtimeProfileStatus, 'fallback');
  const profileStatus = getByTestId(profileTone, 'color-input-profile-status');
  assert.equal(normalizeText(profileStatus.textContent), 'Fallback');
  assert.equal(profileStatus.title, rawDevelopmentReportFixture.cameraProfile.fallbackReason);
  assert.equal(normalizeText(profileTone.textContent).includes('balanced process'), true);
  assert.equal(calibration.open, false, 'Calibration should start collapsed.');
  for (const next of [whiteBalance, globalColor, calibration]) {
    assert.equal(
      profileTone.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
      Node.DOCUMENT_POSITION_FOLLOWING,
      'Input / Profile should lead the Color foundation hierarchy.',
    );
  }
  assert.equal(
    whiteBalance.compareDocumentPosition(globalColor) & Node.DOCUMENT_POSITION_FOLLOWING,
    Node.DOCUMENT_POSITION_FOLLOWING,
    'White Balance should precede Global Color.',
  );
}

async function validateWhiteBalanceFoundation(container: Element) {
  const whiteBalance = getByTestId(container, 'color-quick-white-balance');
  const temperature = getRangeByLabel(whiteBalance, 'Temperature');
  const reset = getByTestId<HTMLButtonElement>(whiteBalance, 'color-white-balance-as-shot');
  const picker = getByTestId<HTMLButtonElement>(whiteBalance, 'color-white-balance-picker');
  assert.ok(temperature);
  assert.equal(whiteBalance.dataset.whiteBalanceState, 'as-shot');
  assert.equal(reset.disabled, true);

  await changeRange(temperature, 18);
  assert.equal(whiteBalance.dataset.whiteBalanceState, 'custom');
  assert.equal(reset.disabled, false);
  await click(reset);
  assert.equal(temperature.value, '0');
  assert.equal(whiteBalance.dataset.whiteBalanceState, 'as-shot');

  await click(picker);
  assert.equal(picker.getAttribute('aria-pressed'), 'true');
  assert.equal(picker.dataset.state, 'active');
}

function validateMaskLocalFiltering(container: Element) {
  const foundation = getByTestId(container, 'color-foundation-controls');
  assert.equal(foundation.querySelector('[data-testid="profile-tone-controls"]'), null);
  assert.equal(foundation.querySelector('[data-testid="color-calibration-disclosure"]'), null);
  assert.equal(foundation.querySelector('[data-testid="color-white-balance-picker"]'), null);
  assert.equal(getRangeByLabel(foundation, 'Local Hue'), null);
  assert.equal(
    normalizeText(getByTestId(foundation, 'color-quick-white-balance').textContent).includes('Local Color Balance'),
    true,
  );
}

async function validateCompactMixerSurface(container: Element) {
  const colorMixer = getByTestId(container, 'color-mixer-controls');
  const hslControls = getByTestId(container, 'selective-color-range-controls');
  const localRangeDisclosure = getByTestId<HTMLDetailsElement>(container, 'local-color-range-adjustment-disclosure');
  const advancedDisclosure = getByTestId<HTMLDetailsElement>(container, 'advanced-color-disclosure');

  assert.equal(container.querySelector('[data-color-inspector-density="compact"]') !== null, true);
  assert.equal(colorMixer.querySelector('[data-inspector-section-header="true"]') !== null, true);
  assert.equal(advancedDisclosure.querySelector('[data-inspector-section-header="true"]') !== null, true);
  assert.equal(
    hslControls.querySelectorAll('[role="tab"]').length,
    8,
    'Color Mixer should expose eight stable ranges.',
  );
  assert.ok(hslControls.querySelector('[role="radiogroup"]'), 'Color Mixer should expose its Color/HSL mode selector.');
  assert.equal(colorMixer.className.includes('rounded'), false, 'Color Mixer should not be framed as a card.');
  assert.equal(
    advancedDisclosure.className.includes('rounded'),
    false,
    'Advanced Color should use a sectional disclosure.',
  );
  assert.equal(container.querySelector('[data-testid="color-workspace-warning-chips"]'), null);
  assert.equal(container.querySelector('[data-testid="professional-color-recipes-disclosure"]'), null);
  assert.equal(container.querySelector('[data-testid="selective-color-mask-preview-toggle"]'), null);
  assert.equal(colorMixer.querySelector('[data-testid="color-balance-disclosure"]'), null);
  assert.equal(colorMixer.querySelector('[data-testid="channel-mixer-disclosure"]'), null);
  assert.equal(colorMixer.querySelector('[data-testid="black-white-mixer-disclosure"]'), null);

  for (const label of ['Hue', 'Saturation', 'Luminance']) {
    assert.ok(getRangeByLabel(container, label), `Primary HSL slider was not rendered: ${label}.`);
  }
  assert.equal(localRangeDisclosure.dataset.scope, 'local-adjustment');
  assert.equal(localRangeDisclosure.open, false, 'Range refinement should start collapsed.');
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
  assert.equal(normalizeText(localRangeSummary.textContent).startsWith('Range'), true);
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
