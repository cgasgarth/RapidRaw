#!/usr/bin/env bun

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { type AppSettings, type SelectedImage, Theme } from '../../../../src/components/ui/AppProperties';
import {
  ExportColorProfile,
  type ExportPreset,
  ExportRenderingIntent,
  WatermarkAnchor,
} from '../../../../src/components/ui/ExportImportProperties';
import type { GamutWarningOverlayPayload } from '../../../../src/schemas/tauriEventSchemas';
import { useEditorStore } from '../../../../src/store/useEditorStore';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments';
import { formatGamutWarningCoverage } from '../../../../src/utils/color/runtime/gamutWarningDisplay.ts';

type RenderedPanel = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
};

type AdjustmentUpdate = Partial<Adjustments> | ((previous: Adjustments) => Adjustments);

const failures: string[] = [];
const professionalImagePath = '/validation/professional-color-workflow.ARW';
const professionalTransform = {
  blackPointCompensation: 'Unsupported',
  colorManagedTransform: 'moxcms Display P3 Relative Colorimetric 8-bit',
  effectiveColorProfile: 'Display P3',
  effectiveRenderingIntent: 'Relative Colorimetric',
  policyStatus: 'color_managed',
  policyVersion: 'rawengine.export-color-policy.v1',
  sourcePrecisionPath: 'float16-preview',
  transformApplied: true,
  transformPolicyFingerprint: 'sha256:professional-color-workflow',
};
const professionalOverlayFixture = {
  black_point_compensation: professionalTransform.blackPointCompensation,
  color_managed_transform: professionalTransform.colorManagedTransform,
  coverage_ratio: 0.125,
  effective_color_profile: professionalTransform.effectiveColorProfile,
  effective_rendering_intent: professionalTransform.effectiveRenderingIntent,
  export_soft_proof_recipe_id: 'professional-display-p3-jpeg',
  height: 180,
  mask_data_url: 'data:image/png;base64,AAAA',
  max_channel_value: 255,
  min_channel_value: 0,
  pixel_count: 360,
  policy_status: professionalTransform.policyStatus,
  policy_version: professionalTransform.policyVersion,
  preview_basis: 'export_preview',
  source_image_path: professionalImagePath,
  source_precision_path: professionalTransform.sourcePrecisionPath,
  transform_applied: professionalTransform.transformApplied,
  transform_policy_fingerprint: professionalTransform.transformPolicyFingerprint,
  warning_pixel_count: 45,
  width: 240,
} satisfies GamutWarningOverlayPayload;
const professionalSelectedImageFixture: SelectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: professionalImagePath,
  rawDevelopmentReport: null,
  thumbnailUrl: 'data:image/jpeg;base64,AAAA',
  width: 4000,
};
const exportPresetFixture = {
  colorProfile: ExportColorProfile.DisplayP3,
  dontEnlarge: true,
  enableResize: false,
  enableWatermark: false,
  fileFormat: 'jpeg',
  filenameTemplate: '{original_filename}-professional',
  id: 'professional-display-p3-jpeg',
  jpegQuality: 92,
  keepMetadata: true,
  name: 'Display P3 JPEG proof',
  preserveTimestamps: true,
  renderingIntent: ExportRenderingIntent.RelativeColorimetric,
  resizeMode: 'longEdge',
  resizeValue: 2400,
  stripGps: false,
  watermarkAnchor: WatermarkAnchor.BottomRight,
  watermarkOpacity: 50,
  watermarkPath: null,
  watermarkScale: 20,
  watermarkSpacing: 2,
} satisfies ExportPreset;
const appSettingsFixture = {
  exportPresets: [exportPresetFixture],
  lastRootPath: null,
  theme: Theme.Dark,
  useWgpuRenderer: true,
} satisfies AppSettings;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const { default: ColorPanel } = await import('../../../../src/components/adjustments/Color');

await validateLocaleContract();
const rendered = await renderColorPanel();
await validateFoundationalColorControlOrder(rendered.container);
await validatePresentationGrouping(rendered.container);
await validateColorWorkspaceTabKeyboard(rendered.container);
await validateColorWorkspaceHeaderDensity(rendered.container);
await selectColorWorkspaceTab(rendered.container, 'output');
await openDisclosure(rendered.container, 'color-proofing-diagnostics-disclosure');
await validateRenderedWorkspaceCoverage(rendered.container);
await validateGamutWarningCoverage(rendered.container);
await validateProfileToneReceipt(rendered.container);
await validateRecipeApplication(rendered.container);
await validateSkinToneUniformityCoverage(rendered.container);
rendered.unmount();
await validateColorWorkspaceTabPersistence();

if (failures.length > 0) {
  console.error('professional color workflow rendered coverage failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('professional color workflow rendered coverage ok');

async function validateLocaleContract() {
  const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')) as {
    adjustments?: { color?: Record<string, unknown> };
  };
  const colorLocale = locale.adjustments?.color;
  const requiredLocaleKeys = [
    'channelMixer.title',
    'colorBalanceRgb.title',
    'colorGrading',
    'colorMixer',
    'collapsed',
    'advanced.summary',
    'advanced.title',
    'calibration.disclosureSummary',
    'gamutWarning.coverage',
    'gamutWarning.off',
    'gamutWarning.on',
    'gamutWarning.proofDetails',
    'gamutWarning.title',
    'profileTone.receiptExportParity',
    'profileTone.receiptRuntime',
    'profileTone.receiptSummary',
    'profileTone.receiptTitle',
    'profileTone.title',
    'skinToneUniformity.description',
    'skinToneUniformity.disabled',
    'skinToneUniformity.enabled',
    'skinToneUniformity.hue',
    'skinToneUniformity.hueCap',
    'skinToneUniformity.lightness',
    'skinToneUniformity.preview',
    'skinToneUniformity.saturation',
    'skinToneUniformity.targetHue',
    'skinToneUniformity.targetLightness',
    'skinToneUniformity.targetSaturation',
    'skinToneUniformity.title',
    'skinToneUniformity.warning',
    'proofingDiagnostics.summary',
    'proofingDiagnostics.title',
    'workflowRecipes.apply',
    'workflowRecipes.cleanPortrait',
    'workflowRecipes.cleanPortraitDescription',
    'workflowRecipes.description',
    'workflowRecipes.landscapeDepth',
    'workflowRecipes.landscapeDepthDescription',
    'workflowRecipes.neutralProduct',
    'workflowRecipes.neutralProductDescription',
    'workflowRecipes.profileChip',
    'workflowRecipes.rangeChip',
    'workflowRecipes.toneChip',
    'workflowRecipes.whiteBalanceChip',
    'workflowRecipes.title',
  ];
  const missing = requiredLocaleKeys.filter((key) => typeof getValue(colorLocale, key) !== 'string');

  failures.push(...missing.map((key) => `missing professional color workflow locale key: ${key}`));
}

async function validatePresentationGrouping(container: Element) {
  assertClosedDisclosure(
    getByTestId<HTMLDetailsElement>(container, 'professional-color-recipes-disclosure'),
    'workflow recipes disclosure should start collapsed.',
  );
  assertClosedDisclosure(
    getByTestId<HTMLDetailsElement>(container, 'color-proofing-diagnostics-disclosure'),
    'proofing diagnostics disclosure should start collapsed.',
  );
  assertClosedDisclosure(
    getByTestId<HTMLDetailsElement>(container, 'advanced-color-disclosure'),
    'advanced color disclosure should start collapsed.',
  );

  const quickWhiteBalance = getByTestId(container, 'color-quick-white-balance');
  const quickPresence = getByTestId(container, 'color-quick-presence');
  const profileTone = getByTestId(container, 'profile-tone-controls');
  const proofing = getByTestId(container, 'color-proofing-diagnostics-disclosure');
  const advanced = getByTestId(container, 'advanced-color-disclosure');
  assertPrecedes(
    quickWhiteBalance,
    profileTone,
    'white-balance controls should render before profile/proofing groups.',
  );
  assertPrecedes(quickPresence, proofing, 'presence controls should render before proofing diagnostics.');
  assertPrecedes(advanced, proofing, 'advanced color calibration should remain with the main color tools.');

  assertVisibleText(proofing, 'Display P3 gamut · 12.5%', 'proofing disclosure did not keep gamut status visible.');
}

async function validateColorWorkspaceTabKeyboard(container: Element) {
  const tablist = getByTestId(container, 'color-workspace-tabs');

  const quick = getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-quick');
  const editor = getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-editor');
  const grading = getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-grading');
  const output = getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-output');

  assertSelectedTab(quick, 'Quick should start selected.');
  await dispatchTabKey(tablist, 'ArrowRight');
  assertSelectedTab(editor, 'ArrowRight should select Editor.');
  assertFocused(editor, 'ArrowRight should focus Editor.');
  await dispatchTabKey(tablist, 'ArrowDown');
  assertSelectedTab(grading, 'ArrowDown should select Grading.');
  await dispatchTabKey(tablist, 'End');
  assertSelectedTab(output, 'End should select Output.');
  await dispatchTabKey(tablist, 'ArrowLeft');
  assertSelectedTab(grading, 'ArrowLeft should select Grading from Output.');
  await dispatchTabKey(tablist, 'Home');
  assertSelectedTab(quick, 'Home should return to Quick.');
}

async function validateColorWorkspaceHeaderDensity(container: Element) {
  const header = getByTestId(container, 'color-workspace-tab-header');
  const tablist = getByTestId(container, 'color-workspace-tabs');
  const statusRow = getByTestId(container, 'color-workspace-warning-chips');
  assertData(header, 'sticky', 'true', 'color workspace header should expose sticky placement for visual proof.');
  assertData(header, 'gamutWarningCount', '45', 'color workspace header did not expose gamut warning count.');
  assertData(header, 'warningCount', '2', 'color workspace header did not expose actionable warning count.');
  assertData(header, 'previewWarningState', 'current', 'color workspace header did not expose gamut warning state.');
  assertData(header, 'scopeFreshnessState', 'current', 'color workspace header did not expose scope freshness state.');

  const tablistClassName = tablist.getAttribute('class') ?? '';
  if (
    !tablistClassName.includes('grid-cols-4') ||
    !tablistClassName.includes('min-w-0') ||
    tablistClassName.includes('flex-wrap') ||
    tablistClassName.includes('overflow-x-auto')
  ) {
    failures.push('color workspace tabs should remain one fixed four-column row without horizontal scrolling.');
  }
  const statusRowClassName = statusRow.getAttribute('class') ?? '';
  if (
    !statusRowClassName.includes('h-6') ||
    !statusRowClassName.includes('overflow-hidden') ||
    statusRowClassName.includes('flex-wrap') ||
    statusRowClassName.includes('overflow-x-auto')
  ) {
    failures.push('color workspace status should remain a single compact summary without horizontal scrolling.');
  }

  for (const tabId of ['quick', 'editor', 'grading', 'output']) {
    const tab = getByTestId(container, `color-workspace-tab-${tabId}`);
    const tabClassName = tab.getAttribute('class') ?? '';
    if (!tabClassName.includes('min-w-0') || !tabClassName.includes('text-[10px]')) {
      failures.push(`color workspace ${tabId} tab lost its compact equal-column treatment.`);
    }
    const tabLabel = normalizeText(tab.textContent);
    if (
      tab.getAttribute('aria-label') !== tabLabel ||
      tab.getAttribute('data-tooltip') !== tabLabel ||
      tab.getAttribute('title') !== tabLabel
    ) {
      failures.push(`color workspace ${tabId} tab should preserve its full accessible label and tooltip.`);
    }
  }

  const primaryStatus = getByTestId(container, 'color-workspace-primary-status');
  const primaryStatusLabel = normalizeText(primaryStatus.textContent);
  if (
    primaryStatusLabel.length === 0 ||
    primaryStatus.getAttribute('data-tooltip') !== primaryStatusLabel ||
    primaryStatus.getAttribute('title') !== primaryStatusLabel
  ) {
    failures.push('color workspace primary status should retain its complete tooltip text.');
  }
  const statusSummary = statusRow.getAttribute('aria-label') ?? '';
  for (const expectedStatus of ['Display P3 gamut · 12.5%', primaryStatusLabel]) {
    if (!statusSummary.includes(expectedStatus)) {
      failures.push(`color workspace accessible status summary omitted: ${expectedStatus}`);
    }
  }
  if (statusRow.getAttribute('data-tooltip') !== statusSummary || statusRow.getAttribute('title') !== statusSummary) {
    failures.push('color workspace summary should expose every status in its tooltip.');
  }

  const statusDetails = getByTestId<HTMLButtonElement>(container, 'color-workspace-status-details');
  if (
    normalizeText(statusDetails.textContent) !== '+1' ||
    !statusDetails.getAttribute('aria-label')?.includes(statusSummary) ||
    statusDetails.getAttribute('data-tooltip') !== statusSummary ||
    statusDetails.getAttribute('title') !== statusSummary
  ) {
    failures.push('color workspace status count should expose and link the complete diagnostics summary.');
  }
  await act(async () => {
    statusDetails.click();
    await flushPromises();
  });
  assertSelectedTab(
    getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-output'),
    'status details should select the Output workspace.',
  );
  if (!getByTestId<HTMLDetailsElement>(container, 'color-proofing-diagnostics-disclosure').open) {
    failures.push('status details should open the existing proofing diagnostics disclosure.');
  }
  await act(async () => {
    getByTestId<HTMLButtonElement>(container, 'color-workspace-tab-quick').click();
    await flushPromises();
  });
}

async function validateColorWorkspaceTabPersistence() {
  const firstRender = await renderColorPanel();
  const editor = getByTestId<HTMLButtonElement>(firstRender.container, 'color-workspace-tab-editor');
  await act(async () => {
    editor.click();
    await flushPromises();
  });
  assertSelectedTab(editor, 'Editor should be selected before remount persistence proof.');
  firstRender.unmount();

  const secondRender = await renderColorPanel();
  const restoredEditor = getByTestId<HTMLButtonElement>(secondRender.container, 'color-workspace-tab-editor');
  assertSelectedTab(restoredEditor, 'Editor tab should restore after Color panel remount.');
  await act(async () => {
    getByTestId<HTMLButtonElement>(secondRender.container, 'color-workspace-tab-quick').click();
    await flushPromises();
  });
  secondRender.unmount();
}

async function selectColorWorkspaceTab(container: Element, tabId: string) {
  const tab = getByTestId<HTMLButtonElement>(container, `color-workspace-tab-${tabId}`);
  await act(async () => {
    tab.click();
    await flushPromises();
  });
  assertSelectedTab(tab, `${tabId} should be selected before validating its panel.`);
}

async function renderColorPanel(): Promise<RenderedPanel> {
  useEditorStore.getState().setEditor({
    exportSoftProofRecipeId: 'professional-display-p3-jpeg',
    exportSoftProofTransform: professionalTransform,
    gamutWarningOverlay: professionalOverlayFixture,
    isExportSoftProofEnabled: true,
    isGamutWarningOverlayVisible: false,
    previewScopeStatus: {
      displayTransformLabel: professionalTransform.colorManagedTransform,
      exportProfileLabel: professionalTransform.effectiveColorProfile,
      exportRenderingIntentLabel: professionalTransform.effectiveRenderingIntent,
      histogramReady: true,
      path: professionalImagePath,
      renderBasis: 'export_preview',
      softProofTransformApplied: true,
      sourceLabel: 'Export preview',
      updatedAt: '2026-07-01T12:00:00.000Z',
      waveformReady: true,
      warningCodes: ['export_profile_transform_applied', 'render_target_matches_export_recipe'],
      workingTransformLabel: 'Working RGB',
    },
    selectedImage: professionalSelectedImageFixture,
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
          initialAdjustments: createProfessionalAdjustmentsFixture(),
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

async function validateRenderedWorkspaceCoverage(container: Element) {
  const proofing = getByTestId<HTMLDetailsElement>(container, 'color-proofing-diagnostics-disclosure');
  if (!proofing.open) proofing.open = true;
  const controls = getByTestId(container, 'gamut-warning-controls');
  await waitForText(controls, 'Display P3 gamut · 12.5%', 'soft-proof coverage was not rendered.');
  if (container.querySelector('[data-testid="professional-color-workspace-panel"]')) {
    failures.push('Color output still renders the internal proof receipt panel.');
  }
}

async function validateFoundationalColorControlOrder(container: Element) {
  const quickColor = getByTestId(container, 'quick-color-controls');
  const profileTone = getByTestId(container, 'profile-tone-controls');
  const recipes = getByTestId(container, 'professional-color-recipes');
  const proofing = getByTestId(container, 'color-proofing-diagnostics-disclosure');
  const levels = getByTestId(container, 'color-levels-controls');

  assertAppearsBefore(quickColor, profileTone, 'Quick Color should render before Profile & Tone.');
  assertAppearsBefore(profileTone, recipes, 'Profile & Tone should render before workflow recipes.');
  assertAppearsBefore(profileTone, proofing, 'Profile & Tone should render before proof diagnostics.');
  assertAppearsBefore(profileTone, levels, 'Levels should be downstream from the Profile & Tone controls.');
  assertVisibleText(quickColor, 'White Balance', 'Quick Color did not render white balance first.');
  assertVisibleText(quickColor, 'Presence', 'Quick Color did not render presence controls.');
  assertVisibleText(levels, 'Levels', 'Advanced levels controls were not rendered.');
}

async function validateGamutWarningCoverage(container: Element) {
  const controls = getByTestId(container, 'gamut-warning-controls');
  assertData(controls, 'visible', 'false', 'gamut overlay should start hidden.');
  assertVisibleText(
    controls,
    `Display P3 gamut · ${formatGamutWarningCoverage(professionalOverlayFixture)}`,
    'gamut coverage copy was not rendered.',
  );

  const toggle = getByTestId<HTMLButtonElement>(container, 'gamut-warning-toggle');
  if (toggle.getAttribute('aria-pressed') !== 'false') failures.push('gamut toggle should render off by default.');
  assertVisibleText(toggle, 'Off', 'gamut toggle did not render off copy.');

  await act(async () => {
    toggle.click();
    await flushPromises();
  });
  assertData(getByTestId(container, 'gamut-warning-controls'), 'visible', 'true', 'gamut toggle did not update state.');
  if (getByTestId<HTMLButtonElement>(container, 'gamut-warning-toggle').getAttribute('aria-pressed') !== 'true') {
    failures.push('gamut toggle did not expose pressed state after click.');
  }
  assertVisibleText(getByTestId(container, 'gamut-warning-toggle'), 'On', 'gamut toggle did not render on copy.');
}

async function validateProfileToneReceipt(container: Element) {
  const controls = getByTestId(container, 'profile-tone-controls');
  assertData(controls, 'cameraProfile', 'camera_neutral', 'profile-tone controls did not expose the selected profile.');
  assertData(controls, 'toneCurve', 'linear', 'profile-tone controls did not expose the selected tone curve.');
  if (controls.querySelectorAll('select').length !== 2) {
    failures.push('profile-tone controls should expose camera profile and tone curve selectors.');
  }
}

async function validateRecipeApplication(container: Element) {
  await openDisclosure(container, 'professional-color-recipes-disclosure');
  const recipesDisclosure = getByTestId(container, 'professional-color-recipes-disclosure');
  assertVisibleText(recipesDisclosure, 'Workflow Recipes', 'workflow recipe title was not rendered.');
  assertVisibleText(
    recipesDisclosure,
    'Apply coordinated profile, tone, balance, mixer, selective color, and grading settings.',
    'workflow recipe description was not rendered.',
  );
  const cleanPortrait = getByTestId<HTMLButtonElement>(container, 'professional-color-recipe-cleanPortrait');
  assertData(cleanPortrait, 'cameraProfile', 'camera_portrait', 'clean portrait recipe did not expose profile.');
  assertData(cleanPortrait, 'toneCurve', 'soft_contrast', 'clean portrait recipe did not expose tone curve.');
  assertData(cleanPortrait, 'temperature', '6', 'clean portrait recipe did not expose temperature.');
  assertData(cleanPortrait, 'tint', '3', 'clean portrait recipe did not expose tint.');
  assertData(cleanPortrait, 'vibrance', '12', 'clean portrait recipe did not expose vibrance.');
  assertData(cleanPortrait, 'active', 'false', 'clean portrait recipe should start unapplied.');
  if (cleanPortrait.getAttribute('aria-pressed') !== 'false') {
    failures.push('clean portrait recipe should start with aria-pressed=false.');
  }

  const summaries = Array.from(cleanPortrait.querySelectorAll('[data-testid="professional-color-recipe-summary"]'));
  if (summaries.length !== 1) failures.push('clean portrait recipe summary did not render exactly once.');
  assertVisibleText(cleanPortrait, 'Profile Portrait', 'recipe profile summary chip was not rendered.');
  assertVisibleText(cleanPortrait, 'Tone Soft Contrast', 'recipe tone summary chip was not rendered.');
  assertVisibleText(cleanPortrait, 'WB +6 / +3', 'recipe white-balance summary chip was not rendered.');
  assertVisibleText(cleanPortrait, 'Range Oranges', 'recipe range summary chip was not rendered.');

  await act(async () => {
    cleanPortrait.click();
    await flushPromises();
  });

  const appliedRecipe = getByTestId<HTMLButtonElement>(container, 'professional-color-recipe-cleanPortrait');
  assertData(appliedRecipe, 'active', 'true', 'clean portrait recipe did not expose applied state after click.');
  if (appliedRecipe.getAttribute('aria-pressed') !== 'true') {
    failures.push('clean portrait recipe did not expose aria-pressed=true after click.');
  }
  const profileTone = getByTestId(container, 'profile-tone-controls');
  assertData(profileTone, 'cameraProfile', 'camera_portrait', 'recipe did not update the selected camera profile.');
  assertData(profileTone, 'toneCurve', 'soft_contrast', 'recipe did not update the selected tone curve.');
}

async function validateSkinToneUniformityCoverage(container: Element) {
  const controls = getByTestId(container, 'skin-tone-uniformity-controls');
  assertVisibleText(controls, 'Skin tone - sampled uniformity (Experimental)', 'skin-tone controls title missing.');
  assertVisibleText(
    controls,
    'May affect other orange-range colors; not skin detection or Capture One equivalence.',
    'skin-tone warning copy missing.',
  );
  for (const label of [
    'Hue uniformity',
    'Saturation uniformity',
    'Lightness uniformity',
    'Hue cap',
    'Target hue',
    'Target saturation',
    'Target lightness',
  ]) {
    const slider = getRangeByLabel(container, label);
    if (slider === null) failures.push(`skin-tone slider was not rendered: ${label}`);
  }
  const toggle = getByTestId<HTMLButtonElement>(container, 'skin-tone-uniformity-toggle');
  if (toggle.getAttribute('aria-pressed') !== 'true') failures.push('skin-tone toggle should start enabled.');
  assertVisibleText(toggle, 'On', 'skin-tone toggle did not render enabled copy.');

  await act(async () => {
    toggle.click();
    await flushPromises();
  });
  const disabledToggle = getByTestId<HTMLButtonElement>(container, 'skin-tone-uniformity-toggle');
  if (disabledToggle.getAttribute('aria-pressed') !== 'false') {
    failures.push('skin-tone toggle did not expose disabled state after click.');
  }
  assertVisibleText(disabledToggle, 'Off', 'skin-tone toggle did not render disabled copy.');
}

function createProfessionalAdjustmentsFixture(): Adjustments {
  return {
    ...structuredClone(INITIAL_ADJUSTMENTS),
    cameraProfile: 'camera_neutral',
    skinToneUniformity: {
      ...INITIAL_ADJUSTMENTS.skinToneUniformity,
      enabled: true,
    },
    toneCurve: 'linear',
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
  const window = new Window({ url: 'http://localhost/professional-color-workflow-coverage' });
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
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: window.Node });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: window.MutationObserver });
  Object.defineProperty(globalThis, 'PointerEvent', { configurable: true, value: window.PointerEvent ?? window.Event });
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: window.KeyboardEvent });
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

async function dispatchTabKey(tablist: HTMLElement, key: string) {
  await act(async () => {
    tablist.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));
    await flushPromises();
    await flushPromises();
  });
}

function assertSelectedTab(tab: HTMLButtonElement, message: string) {
  if (tab.getAttribute('aria-selected') !== 'true' || tab.tabIndex !== 0) failures.push(message);
}

function assertFocused(tab: HTMLButtonElement, message: string) {
  if (document.activeElement !== tab) failures.push(message);
}

function getByTestId<T extends HTMLElement = HTMLElement>(container: Element, testId: string): T {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  assert.ok(element, `missing test id: ${testId}`);
  return element as T;
}

async function openDisclosure(container: Element, testId: string) {
  const disclosure = getByTestId<HTMLDetailsElement>(container, testId);
  if (disclosure.open) return;
  const summary = disclosure.querySelector('summary');
  assert.ok(summary, `missing summary for disclosure: ${testId}`);
  await act(async () => {
    summary.click();
    await flushPromises();
  });
  if (!disclosure.open) failures.push(`disclosure did not open: ${testId}`);
}

function assertClosedDisclosure(disclosure: HTMLDetailsElement, message: string) {
  if (disclosure.open || disclosure.hasAttribute('open')) failures.push(message);
}

function assertPrecedes(first: Element, second: Element, message: string) {
  if ((first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) failures.push(message);
}

function getRangeByLabel(container: Element, label: string): HTMLInputElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLInputElement>('input[type="range"]')).find(
      (input) => input.getAttribute('aria-label') === label,
    ) ?? null
  );
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

function assertData(element: HTMLElement, key: string, expected: string, message: string) {
  const actual = element.dataset[key];
  if (actual !== expected) failures.push(`${message} Expected ${expected}, got ${actual ?? '<missing>'}.`);
}

function assertAppearsBefore(first: Element, second: Element, message: string) {
  if ((first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) {
    failures.push(message);
  }
}

function getValue(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (value && typeof value === 'object' && segment in value) {
      return (value as Record<string, unknown>)[segment];
    }
    return undefined;
  }, root);
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
