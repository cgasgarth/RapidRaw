#!/usr/bin/env bun

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { readLayerStackSidecarsFromSidecar } from '../../../../packages/rawengine-schema/src';
import type { ColorPanelAdjustmentView } from '../../../../src/components/adjustments/color/types';
import { selectColorPanelAdjustmentView } from '../../../../src/components/panel/right/color/ColorWorkspacePanel';
import { type AppSettings, Theme } from '../../../../src/components/ui/AppProperties';
import { createEditorImageSession, useEditorStore } from '../../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments';
import {
  COLOR_OUTPUT_FOCUS_EVENT,
  COLOR_WORKSPACE_TAB_SESSION_KEY,
} from '../../../../src/utils/colorWorkspaceNavigation';
import { selectEditDocumentMasks } from '../../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../../src/utils/editDocumentV2';

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
  await validateKeyboardWorkspaceNavigation(rendered.container);
  await selectMixerWorkspace(rendered.container);
  await validateCompactMixerSurface(rendered.container);
  await validateHslSurfaceInteraction(rendered.container);
  await validateColorBalanceRgbTransaction(rendered.container);
  await validateLevelsTransaction(rendered.container);
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
    await validateMaskHslAuthority(localRendered.container);
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
    const editDocumentV2 = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:color-foundation-preview',
      history: [editDocumentV2],
      historyCheckpoints: [],
      historyIndex: 0,
      lastEditApplicationReceipt: null,
      navigatorPreviewArtifact: null,
      transformedOriginalUrl: 'blob:color-foundation-transformed',
    });
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
          initialAdjustments: selectColorPanelAdjustmentView(useEditorStore.getState().editDocumentV2),
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
  initialAdjustments: ColorPanelAdjustmentView;
  isForMask: boolean;
}) {
  const [adjustments, setAdjustmentState] = useState(initialAdjustments);
  const [isWbPickerActive, setIsWbPickerActive] = useState(false);
  useEffect(() => {
    if (isForMask) return;
    return useEditorStore.subscribe((state) =>
      setAdjustmentState(selectColorPanelAdjustmentView(state.editDocumentV2)),
    );
  }, [isForMask]);
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

async function selectPointColorWorkspace(container: Element) {
  await click(getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-point-color'));
  assert.equal(
    getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-point-color').getAttribute('aria-selected'),
    'true',
    'Point Color workspace should be selected.',
  );
}

async function validateKeyboardWorkspaceNavigation(container: Element) {
  const tablist = getByTestId<HTMLDivElement>(container, 'color-workspace-tabs');
  const pointColor = getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-point-color');

  await act(async () => {
    tablist.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));
    await flushPromises();
  });
  assert.equal(
    pointColor.getAttribute('aria-selected'),
    'true',
    'ArrowRight should select Point Color from Foundation.',
  );
  assert.equal(document.activeElement, pointColor, 'ArrowRight should focus the selected workspace.');
}

function validateFoundationHierarchy(container: Element) {
  const foundation = getByTestId(container, 'color-foundation-controls');
  const toneCurve = getByTestId(foundation, 'profile-tone-controls');

  assert.equal(getByTestId(container, 'color-workspace-tab-foundation').getAttribute('aria-selected'), 'true');
  assert.equal(toneCurve.querySelector('[data-testid="camera-profile-browser"]'), null);
  assert.ok(toneCurve.querySelector('select[aria-label="Tone Curve"]'));
  assert.equal(foundation.querySelector('[data-testid="color-quick-white-balance"]'), null);
  assert.equal(
    foundation.querySelector('[data-testid="color-calibration-disclosure"]'),
    null,
    'Color foundation must not duplicate the standalone Develop Calibration section.',
  );
  assert.equal(
    foundation.querySelector('[data-testid="color-quick-presence"]'),
    null,
    'Color foundation must not duplicate the Basic Presence section.',
  );
  assert.ok(getByTestId(foundation, 'color-quick-hue'));
}

function validateMaskLocalFiltering(container: Element) {
  const foundation = getByTestId(container, 'color-foundation-controls');
  assert.equal(foundation.querySelector('[data-testid="profile-tone-controls"]'), null);
  assert.equal(foundation.querySelector('[data-testid="color-calibration-disclosure"]'), null);
  assert.equal(foundation.querySelector('[data-testid="color-white-balance-picker"]'), null);
  assert.equal(getRangeByLabel(foundation, 'Local Hue'), null);
  assert.equal(
    container.querySelector('[data-testid="color-balance-disclosure"]'),
    null,
    'Global Color Balance RGB must remain outside mask-local adjustment authority.',
  );
  assert.equal(
    normalizeText(getByTestId(foundation, 'color-quick-white-balance').textContent).includes('Local Color Balance'),
    true,
  );
}

function getColorAdjustments(state = useEditorStore.getState()): ColorPanelAdjustmentView {
  return selectColorPanelAdjustmentView(state.editDocumentV2);
}

async function validateMaskPointColorAuthority(container: Element) {
  await selectPointColorWorkspace(container);
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

async function validateMaskHslAuthority(container: Element) {
  await selectMixerWorkspace(container);
  const before = useEditorStore.getState();
  const hue = getByTestId<HTMLInputElement>(container, 'color-mixer-hue-reds-range');
  assert.ok(hue, 'Mask Hue slider was not rendered.');
  await changeRange(hue, 11);
  assert.equal(hue.value, '11', 'Mask HSL must update its local adjustment state.');
  assert.equal(
    useEditorStore.getState().adjustmentRevision,
    before.adjustmentRevision,
    'Mask HSL must not redirect its local edit into the global transaction authority.',
  );
  assert.deepEqual(
    getColorAdjustments().hsl,
    getColorAdjustments(before).hsl,
    'Mask HSL must not replace the global HSL document.',
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
  for (const [mode, label] of [
    ['hue', 'Hue'],
    ['saturation', 'Saturation'],
    ['luminance', 'Luminance'],
  ] as const) {
    await click(getByTestId<HTMLButtonElement>(hslControls, `color-mixer-mode-${mode}`));
    assert.ok(
      getByTestId<HTMLInputElement>(hslControls, `color-mixer-${mode}-reds-range`),
      `Primary HSL slider was not rendered: ${label}.`,
    );
  }
  await click(getByTestId<HTMLButtonElement>(hslControls, 'color-mixer-mode-hue'));
  assert.equal(localRangeDisclosure.dataset.scope, 'local-adjustment');
  assert.equal(localRangeDisclosure.open, false, 'Range refinement should start collapsed.');
}

async function validateHslSurfaceInteraction(container: Element) {
  const hslControls = getByTestId(container, 'selective-color-range-controls');
  const hue = getByTestId<HTMLInputElement>(hslControls, 'color-mixer-hue-reds-range');
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
  const beforeRange = useEditorStore.getState();
  await changeRange(rangeCenter, 42);
  const rangeCommitted = useEditorStore.getState();
  assert.equal(rangeCommitted.adjustmentRevision, beforeRange.adjustmentRevision + 1);
  assert.equal(rangeCommitted.history.length, beforeRange.history.length + 1);
  assert.equal(getColorAdjustments(rangeCommitted).selectiveColorRangeControls.oranges.centerHueDegrees, 42);
  assert.equal(rangeCommitted.lastEditApplicationReceipt?.source, 'manual-control');
  assert.equal(rangeCommitted.finalPreviewUrl, null, 'Global range commit must invalidate rendered output.');
  assert.equal(rangeCommitted.transformedOriginalUrl, null, 'Global range commit must invalidate transformed output.');
  assert.equal(getByTestId<HTMLButtonElement>(container, 'selective-color-reset-active-range').disabled, true);
  assert.equal(getByTestId<HTMLButtonElement>(container, 'local-color-range-reset').disabled, false);

  const beforeHue = useEditorStore.getState();
  const activeHue = getByTestId<HTMLInputElement>(
    getByTestId(container, 'selective-color-range-controls'),
    'color-mixer-hue-oranges-range',
  );
  assert.ok(activeHue, 'Active Hue slider was not rendered after the range commit.');
  await changeRange(activeHue, 8);
  assert.equal(useEditorStore.getState().adjustmentRevision, beforeHue.adjustmentRevision + 1);
  assert.equal(getColorAdjustments().hsl.oranges.hue, 8);
  await click(getByTestId<HTMLButtonElement>(container, 'selective-color-reset-active-range'));
  assert.equal(getColorAdjustments().hsl.oranges.hue, 0);
  assert.equal(
    getRangeByLabel(localRangeDisclosure, 'Range center')?.value,
    '42',
    'Resetting HSL must not reset the local mask range.',
  );
  assert.equal(getByTestId<HTMLButtonElement>(container, 'local-color-range-reset').disabled, false);

  const beforeMixerReset = useEditorStore.getState();
  await click(getByTestId<HTMLButtonElement>(container, 'selective-color-reset-mixer'));
  const reset = useEditorStore.getState();
  assert.equal(reset.adjustmentRevision, beforeMixerReset.adjustmentRevision + 1);
  assert.equal(reset.history.length, beforeMixerReset.history.length + 1);
  assert.deepEqual(getColorAdjustments(reset).hsl, INITIAL_ADJUSTMENTS.hsl);
  assert.deepEqual(
    getColorAdjustments(reset).selectiveColorRangeControls,
    INITIAL_ADJUSTMENTS.selectiveColorRangeControls,
  );
  assert.equal(
    getRangeByLabel(localRangeDisclosure, 'Range center')?.value,
    String(INITIAL_ADJUSTMENTS.selectiveColorRangeControls.oranges.centerHueDegrees),
  );

  await act(async () => {
    useEditorStore.getState().undo();
    await flushPromises();
  });
  assert.equal(
    getRangeByLabel(localRangeDisclosure, 'Range center')?.value,
    '42',
    'Undo must restore the complete pre-reset mixer state.',
  );
  await act(async () => {
    useEditorStore.getState().redo();
    await flushPromises();
  });
}

async function validateColorBalanceRgbTransaction(container: Element) {
  const disclosure = getByTestId<HTMLDetailsElement>(container, 'color-balance-disclosure');
  const summary = disclosure.querySelector<HTMLElement>('summary');
  assert.ok(summary, 'Color Balance RGB summary was not rendered.');
  await click(summary);

  await act(async () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:color-balance-rendered-before',
      transformedOriginalUrl: 'blob:color-balance-transformed-before',
    });
    await flushPromises();
  });
  const beforeToggle = useEditorStore.getState();
  await click(getByTestId<HTMLButtonElement>(container, 'color-balance-toggle'));
  const toggled = useEditorStore.getState();
  assert.equal(toggled.adjustmentRevision, beforeToggle.adjustmentRevision + 1);
  assert.equal(toggled.history.length, beforeToggle.history.length + 1);
  assert.equal(getColorAdjustments(toggled).colorBalanceRgb.enabled, true);
  assert.equal(toggled.lastEditApplicationReceipt?.source, 'manual-control');
  assert.equal(toggled.finalPreviewUrl, null, 'Color Balance RGB toggle must invalidate rendered output.');
  assert.equal(toggled.transformedOriginalUrl, null, 'Color Balance RGB toggle must invalidate transformed output.');

  const controls = getByTestId(container, 'color-balance-controls');
  const red = getRangeByLabel(controls, 'Red');
  assert.ok(red, 'Color Balance RGB red slider was not rendered.');
  const beforeChannel = useEditorStore.getState();
  await changeRange(red, 17);
  assert.equal(useEditorStore.getState().adjustmentRevision, beforeChannel.adjustmentRevision + 1);
  assert.equal(getColorAdjustments().colorBalanceRgb.midtones.red, 17);

  const preserveLuminance = getByTestId(container, 'color-balance-controls').querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  assert.ok(preserveLuminance, 'Color Balance RGB preserve-luminance control was not rendered.');
  await click(preserveLuminance);
  assert.equal(getColorAdjustments().colorBalanceRgb.preserveLuminance, false);

  const beforeRangeReset = useEditorStore.getState();
  await click(getByTestId<HTMLButtonElement>(container, 'color-balance-reset-range'));
  const rangeReset = useEditorStore.getState();
  assert.equal(rangeReset.adjustmentRevision, beforeRangeReset.adjustmentRevision + 1);
  assert.deepEqual(
    getColorAdjustments(rangeReset).colorBalanceRgb.midtones,
    INITIAL_ADJUSTMENTS.colorBalanceRgb.midtones,
  );
  assert.equal(getColorAdjustments(rangeReset).colorBalanceRgb.enabled, false);
  assert.equal(getColorAdjustments(rangeReset).colorBalanceRgb.preserveLuminance, false);

  const beforeFullReset = useEditorStore.getState();
  await click(getByTestId<HTMLButtonElement>(container, 'color-balance-reset'));
  const fullReset = useEditorStore.getState();
  assert.equal(fullReset.adjustmentRevision, beforeFullReset.adjustmentRevision + 1);
  assert.equal(fullReset.history.length, beforeFullReset.history.length + 1);
  assert.deepEqual(getColorAdjustments(fullReset).colorBalanceRgb, INITIAL_ADJUSTMENTS.colorBalanceRgb);
}

async function validateLevelsTransaction(container: Element) {
  const disclosure = getByTestId<HTMLDetailsElement>(container, 'advanced-color-disclosure');
  const summary = disclosure.querySelector<HTMLElement>('summary');
  assert.ok(summary, 'Levels disclosure summary was not rendered.');
  await click(summary);

  await act(async () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:levels-rendered-before',
      transformedOriginalUrl: 'blob:levels-transformed-before',
    });
    await flushPromises();
  });
  const beforeToggle = useEditorStore.getState();
  await click(getByTestId<HTMLButtonElement>(container, 'color-levels-toggle'));
  const toggled = useEditorStore.getState();
  assert.equal(toggled.adjustmentRevision, beforeToggle.adjustmentRevision + 1);
  assert.equal(toggled.history.length, beforeToggle.history.length + 1);
  assert.equal(getColorAdjustments(toggled).levels.enabled, true);
  assert.equal(toggled.lastEditApplicationReceipt?.source, 'manual-control');
  assert.equal(toggled.finalPreviewUrl, null, 'Levels toggle must invalidate rendered output.');
  assert.equal(toggled.transformedOriginalUrl, null, 'Levels toggle must invalidate transformed output.');

  const changeLevel = async (
    label: string,
    value: number,
    key: Exclude<keyof ColorPanelAdjustmentView['levels'], 'enabled'>,
  ) => {
    const control = getRangeByLabel(getByTestId(container, 'color-levels-controls'), label);
    assert.ok(control, `${label} Levels slider was not rendered.`);
    const before = useEditorStore.getState();
    await changeRange(control, value);
    const committed = useEditorStore.getState();
    assert.equal(committed.adjustmentRevision, before.adjustmentRevision + 1, `${label} must advance one revision.`);
    assert.equal(committed.history.length, before.history.length + 1, `${label} must append one history entry.`);
    assert.equal(committed.lastEditApplicationReceipt?.source, 'manual-control');
    assert.equal(Math.round(getColorAdjustments(committed).levels[key] * 100), value);
  };

  await changeLevel('Input Black', 8, 'inputBlack');
  await changeLevel('Input White', 92, 'inputWhite');
  await changeLevel('Gamma', 125, 'gamma');
  await changeLevel('Output Black', 3, 'outputBlack');
  await changeLevel('Output White', 97, 'outputWhite');

  const beforeReset = useEditorStore.getState();
  const editedLevels = structuredClone(getColorAdjustments(beforeReset).levels);
  await click(getByTestId<HTMLButtonElement>(container, 'color-levels-reset'));
  const reset = useEditorStore.getState();
  assert.equal(reset.adjustmentRevision, beforeReset.adjustmentRevision + 1);
  assert.equal(reset.history.length, beforeReset.history.length + 1);
  assert.deepEqual(getColorAdjustments(reset).levels, INITIAL_ADJUSTMENTS.levels);

  await act(async () => {
    useEditorStore.getState().undo();
    await flushPromises();
  });
  assert.deepEqual(getColorAdjustments().levels, editedLevels);
  assert.equal(
    getRangeByLabel(getByTestId(container, 'color-levels-controls'), 'Gamma')?.value,
    '125',
    'Rendered Undo must restore the complete edited Levels document.',
  );
  await act(async () => {
    useEditorStore.getState().redo();
    await flushPromises();
  });
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
  const committedMasks = selectEditDocumentMasks(committed.editDocumentV2);
  const beforeMasks = selectEditDocumentMasks(before.editDocumentV2);
  assert.equal(committedMasks.length, beforeMasks.length + 1);
  const createdLayer = committedMasks.at(-1);
  assert.ok(createdLayer, 'Color-range transaction did not publish its created layer.');
  assert.equal(committed.activeMaskContainerId, createdLayer.id, 'Created layer was not selected after commit.');
  assert.equal(
    committed.activeMaskId,
    createdLayer.subMasks[0]?.id,
    'Created range mask was not selected after commit.',
  );
  assert.equal(
    readLayerStackSidecarsFromSidecar(committed.editDocumentV2.extensions).at(-1)?.sourceImagePath,
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
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {
      invoke: async (command: string) => {
        assert.equal(command, 'calculate_auto_adjustments');
        return {
          blacks: 0,
          brightness: 0,
          centré: 0,
          clarity: 0,
          contrast: 0,
          dehaze: 0,
          exposure: 0,
          highlights: 0,
          shadows: 0,
          vibrance: 0,
          vignetteAmount: 0,
          whiteBalanceTechnical: {
            adaptation: 'cat16_v1',
            confidence: 0.78,
            contract: 'rapidraw.white_balance.v1',
            duv: 0.008,
            inputSemantics: 'raw_scene_linear',
            kelvin: 4380,
            mode: 'auto',
            presetId: null,
            sampleCount: 412,
            source: 'auto',
            synchronization: { mode: 'per_image', referenceSourceIdentity: null },
            x: 0.36,
            y: 0.35,
          },
          whites: 0,
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
