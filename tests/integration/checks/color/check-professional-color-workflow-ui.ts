#!/usr/bin/env bun

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { readLayerStackSidecarsFromSidecar } from '../../../../packages/rawengine-schema/src';
import { type AppSettings, Theme } from '../../../../src/components/ui/AppProperties';
import { createEditorImageSession, useEditorStore } from '../../../../src/store/useEditorStore';
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
let autoWhiteBalanceInvokeCount = 0;

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
  await validateColorRangeLocalAdjustmentTransaction(rendered.container);
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
    await validateMaskPointColorAuthority(localRendered.container);
    await validateMaskPerceptualGradingAuthority(localRendered.container);
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
      imageSession: createEditorImageSession({
        generation: 1,
        path: '/fixtures/color-foundation.raw',
        source: 'cache',
      }),
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
  const mode = getByTestId<HTMLSelectElement>(whiteBalance, 'color-white-balance-mode');
  const reset = getByTestId<HTMLButtonElement>(whiteBalance, 'color-white-balance-as-shot');
  const picker = getByTestId<HTMLButtonElement>(whiteBalance, 'color-white-balance-picker');
  assert.equal(mode.value, 'as_shot');
  assert.equal(whiteBalance.dataset.whiteBalanceState, 'as-shot');
  assert.equal(reset.disabled, true);

  await changeSelect(mode, 'kelvin_tint');
  const kelvin = getByTestId<HTMLInputElement>(whiteBalance, 'color-white-balance-kelvin');
  await changeInput(kelvin, 3200);
  assert.equal(whiteBalance.dataset.whiteBalanceState, 'custom');
  assert.equal(reset.disabled, false);
  await click(reset);
  assert.equal(mode.value, 'as_shot');
  assert.equal(whiteBalance.querySelector('[data-testid="color-white-balance-kelvin"]'), null);
  assert.equal(whiteBalance.dataset.whiteBalanceState, 'as-shot');

  await changeSelect(mode, 'auto');
  assert.equal(mode.value, 'auto');
  assert.equal(autoWhiteBalanceInvokeCount, 1, 'Auto mode must invoke image analysis exactly once.');
  assert.equal(normalizeText(whiteBalance.textContent).includes('4380 K'), true);
  await click(reset);

  await click(picker);
  assert.equal(picker.getAttribute('aria-pressed'), 'true');
  assert.equal(picker.dataset.state, 'active');
  await click(picker);
  assert.equal(picker.getAttribute('aria-pressed'), 'false');
  assert.equal(picker.dataset.state, 'idle');
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

async function validateMaskPointColorAuthority(container: Element) {
  await selectMixerWorkspace(container);
  const adjustmentRevision = useEditorStore.getState().adjustmentRevision;
  const enable = getByTestId<HTMLButtonElement>(container, 'point-color-enable');
  assert.equal(normalizeText(enable.textContent), 'Enable');
  await click(enable);
  assert.equal(
    normalizeText(enable.textContent),
    'Enabled',
    'Mask Point Color must update its local adjustment state.',
  );
  assert.equal(
    useEditorStore.getState().adjustmentRevision,
    adjustmentRevision,
    'Mask Point Color must not redirect its local edit into the global node document.',
  );
}

async function validateMaskPerceptualGradingAuthority(container: Element) {
  await click(getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-grading'));
  const adjustmentRevision = useEditorStore.getState().adjustmentRevision;
  const controls = getByTestId(container, 'color-grading-controls');
  const presetTrigger = controls.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
  assert.ok(presetTrigger, 'Mask Perceptual Grading preset trigger was not rendered.');
  await click(presetTrigger);
  await click(getByTestId<HTMLButtonElement>(controls, 'color-grading-preset-card'));
  assert.equal(
    getByTestId<HTMLInputElement>(controls, 'color-grading-balance-range').value,
    '8',
    'Mask Perceptual Grading must update its local adjustment state.',
  );
  assert.equal(
    useEditorStore.getState().adjustmentRevision,
    adjustmentRevision,
    'Mask Perceptual Grading must not redirect its local edit into the global node document.',
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
  for (const label of ['Hue', 'Saturation', 'Luminance']) {
    assert.ok(getRangeByLabel(container, label), `Primary HSL slider was not rendered: ${label}.`);
  }
  assert.equal(localRangeDisclosure.dataset.scope, 'local-adjustment');
  assert.equal(localRangeDisclosure.open, false, 'Range refinement should start collapsed.');
}

async function validateDirectProfileToneSelection(container: Element) {
  const controls = getByTestId(container, 'profile-tone-controls');
  const profile = getByTestId(controls, 'camera-profile-browser').querySelector<HTMLButtonElement>('button');
  const toneCurve = controls.querySelector<HTMLSelectElement>('select[aria-label="Tone Curve"]');
  assert.ok(profile, 'Camera Profile browser was not rendered.');
  assert.ok(toneCurve, 'Tone Curve selector was not rendered.');

  await click(profile);
  const portraitProfile = Array.from(
    getByTestId(controls, 'camera-profile-browser-popover').querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => normalizeText(button.textContent) === 'Portrait');
  assert.ok(portraitProfile, 'Portrait was not exposed in the profile browser.');
  await click(portraitProfile);
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

async function validateColorRangeLocalAdjustmentTransaction(container: Element) {
  const before = useEditorStore.getState();
  await click(getByTestId<HTMLButtonElement>(container, 'selective-color-create-local-adjustment'));
  const committed = useEditorStore.getState();

  assert.equal(
    committed.adjustmentRevision,
    before.adjustmentRevision + 1,
    'Color-range layer creation must advance one canonical adjustment revision.',
  );
  assert.equal(
    committed.history.length,
    before.history.length + 1,
    'Color-range layer creation must create exactly one undo boundary.',
  );
  assert.equal(committed.lastEditApplicationReceipt?.source, 'layer-command');
  assert.equal(committed.lastEditApplicationReceipt?.persistence, 'commit');
  assert.equal(committed.adjustments.masks.length, before.adjustments.masks.length + 1);
  const createdLayer = committed.adjustments.masks.at(-1);
  assert.ok(createdLayer, 'Color-range transaction did not publish its created layer.');
  assert.equal(committed.activeMaskContainerId, createdLayer.id, 'Created layer was not selected after commit.');
  assert.equal(
    committed.activeMaskId,
    createdLayer.subMasks[0]?.id,
    'Created range mask was not selected after commit.',
  );
  assert.equal(
    readLayerStackSidecarsFromSidecar(committed.adjustments).at(-1)?.sourceImagePath,
    '/fixtures/color-foundation.raw',
    'Color-range transaction did not preserve its replayable layer sidecar artifact.',
  );
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

async function changeInput(input: HTMLInputElement, value: number) {
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
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {
      invoke: async (command: string) => {
        assert.equal(command, 'calculate_auto_adjustments');
        autoWhiteBalanceInvokeCount += 1;
        return {
          whiteBalanceTechnical: {
            adaptation: 'cat16_v1',
            confidence: 0.78,
            contract: 'rapidraw.white_balance.v1',
            duv: 0.008,
            kelvin: 4380,
            mode: 'auto',
            sampleCount: 412,
            source: 'auto',
            x: 0.36,
            y: 0.35,
          },
        };
      },
    },
  });
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
