#!/usr/bin/env bun

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { type AppSettings, type SelectedImage, Theme } from '../../../src/components/ui/AppProperties';
import {
  ExportColorProfile,
  type ExportPreset,
  ExportRenderingIntent,
  WatermarkAnchor,
} from '../../../src/components/ui/ExportImportProperties';
import type { GamutWarningOverlayPayload } from '../../../src/schemas/tauriEventSchemas';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { applyProfileToneToRgbPixel } from '../../../src/utils/color/profile/profileToneRuntime';
import { formatGamutWarningCoverage } from '../../../src/utils/color/runtime/gamutWarningDisplay.ts';

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

const { default: ColorPanel } = await import('../../../src/components/adjustments/Color');

await validateLocaleContract();
const rendered = await renderColorPanel();
await validateRenderedWorkspaceCoverage(rendered.container);
await validateGamutWarningCoverage(rendered.container);
await validateProfileToneAndReadiness(rendered.container);
await validateRecipeApplication(rendered.container);
await validateSkinToneUniformityCoverage(rendered.container);
rendered.unmount();

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

async function renderColorPanel(): Promise<RenderedPanel> {
  useEditorStore.getState().setEditor({
    exportSoftProofRecipeId: 'professional-display-p3-jpeg',
    exportSoftProofTransform: professionalTransform,
    gamutWarningOverlay: professionalOverlayFixture,
    isExportSoftProofEnabled: true,
    isGamutWarningOverlayVisible: false,
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
  const workspace = getByTestId(container, 'professional-color-workspace-panel');
  assertData(workspace, 'activeCameraProfile', 'camera_neutral', 'workspace did not expose active camera profile.');
  assertData(workspace, 'activeToneCurve', 'linear', 'workspace did not expose active tone curve.');
  assertData(workspace, 'exportTransformLabel', exportPresetFixture.name, 'workspace did not expose export transform.');
  assertData(workspace, 'workingSpaceLabel', 'linear-raw-to-working-rgb', 'workspace did not expose working space.');
  assertData(workspace, 'histogramHook', 'histogram', 'workspace did not expose histogram readiness.');
  assertData(workspace, 'waveformHook', 'waveform', 'workspace did not expose waveform readiness.');
  assertData(workspace, 'vectorscopeHook', 'vectorscope', 'workspace did not expose vectorscope readiness.');
  assertData(workspace, 'gamutWarningCount', '45', 'workspace did not expose gamut warning count.');
  assertData(workspace, 'warningCount', '2', 'workspace warning chips did not include gamut and skin-tone warnings.');
  assertVisibleText(container, exportPresetFixture.name, 'export preset label was not rendered.');
  assertVisibleText(container, 'Linear RAW', 'working-space label was not rendered.');
  assertVisibleText(container, 'Vectorscope', 'scope label was not rendered.');
  await waitForText(container, 'sRGB gamut · 12.5%', 'gamut warning chip copy was not rendered.');
}

async function validateGamutWarningCoverage(container: Element) {
  const controls = getByTestId(container, 'gamut-warning-controls');
  assertData(controls, 'coverageRatio', '0.125000', 'gamut controls did not expose coverage ratio.');
  assertData(controls, 'warningPixelCount', '45', 'gamut controls did not expose warning pixel count.');
  assertData(controls, 'proofMaskWidth', '240', 'gamut controls did not expose proof mask width.');
  assertData(controls, 'proofMaskHeight', '180', 'gamut controls did not expose proof mask height.');
  assertData(controls, 'proofReady', 'true', 'gamut controls did not expose proof readiness.');
  assertData(controls, 'previewBasis', 'export_preview', 'gamut controls did not expose export-preview basis.');
  assertData(
    controls,
    'transformPolicyFingerprint',
    'sha256:professional-color-workflow',
    'gamut controls did not expose transform fingerprint.',
  );
  assertData(controls, 'visible', 'false', 'gamut overlay should start hidden.');
  assertVisibleText(
    controls,
    `sRGB gamut · ${formatGamutWarningCoverage(professionalOverlayFixture)}`,
    'gamut coverage copy was not rendered.',
  );
  assertVisibleText(controls, 'Proof: 45 warning pixels · 240 x 180', 'gamut proof details were not rendered.');

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

async function validateProfileToneAndReadiness(container: Element) {
  const readiness = getByTestId(container, 'professional-color-workflow-readiness');
  assertData(readiness, 'profileToneReady', 'true', 'profile-tone readiness was not exposed.');
  assertData(readiness, 'colorBalanceReady', 'true', 'color-balance readiness was not exposed.');
  assertData(readiness, 'selectiveColorReady', 'true', 'selective-color readiness was not exposed.');
  assertData(readiness, 'channelMixerReady', 'true', 'channel-mixer readiness was not exposed.');
  assertData(readiness, 'gradingReady', 'true', 'grading readiness was not exposed.');

  const readinessText = Array.from(container.querySelectorAll('[data-testid="professional-color-readiness-item"]')).map(
    (element) => normalizeText(element.textContent),
  );
  for (const label of ['Profile & Tone', 'RGB Color Balance', 'Channel Mixer', 'Color Mixer', 'Color Grading']) {
    if (!readinessText.some((text) => text.includes(label) && text.includes('Proofed'))) {
      failures.push(`readiness item was not rendered with proofed status: ${label}`);
    }
  }

  const receipt = getByTestId(container, 'profile-tone-visible-receipt');
  const expectedReceipt = applyProfileToneToRgbPixel(
    { blue: 0.46, green: 0.5, red: 0.54 },
    {
      cameraProfile: 'camera_neutral',
      toneCurve: 'linear',
    },
  );
  assertData(receipt, 'cameraProfile', 'camera_neutral', 'profile-tone receipt did not expose camera profile.');
  assertData(receipt, 'toneCurve', 'linear', 'profile-tone receipt did not expose tone curve.');
  assertData(
    receipt,
    'luminanceBefore',
    expectedReceipt.luminanceBefore.toFixed(4),
    'profile-tone receipt did not expose luminance before.',
  );
  assertData(
    receipt,
    'luminanceAfter',
    expectedReceipt.luminanceAfter.toFixed(4),
    'profile-tone receipt did not expose luminance after.',
  );
  assertData(
    receipt,
    'toneDelta',
    expectedReceipt.toneDelta.toFixed(4),
    'profile-tone receipt did not expose tone delta.',
  );
  assertVisibleText(receipt, 'Profile/tone receipt', 'profile-tone receipt title was not rendered.');
  assertVisibleText(receipt, 'Neutral with Linear is active.', 'profile-tone receipt summary was not rendered.');
  assertVisibleText(
    receipt,
    'Preview/export parity is checked on export receipts.',
    'profile-tone export parity copy was not rendered.',
  );
}

async function validateRecipeApplication(container: Element) {
  const recipes = getByTestId(container, 'professional-color-recipes');
  assertVisibleText(recipes, 'Workflow Recipes', 'workflow recipe title was not rendered.');
  assertVisibleText(
    recipes,
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
  const workspace = getByTestId(container, 'professional-color-workspace-panel');
  assertData(workspace, 'activeCameraProfile', 'camera_portrait', 'recipe did not update workspace profile.');
  assertData(workspace, 'activeToneCurve', 'soft_contrast', 'recipe did not update workspace tone curve.');
  await waitForText(container, 'Portrait with Soft Contrast is active.', 'recipe did not update profile-tone summary.');
}

async function validateSkinToneUniformityCoverage(container: Element) {
  const controls = getByTestId(container, 'skin-tone-uniformity-controls');
  assertData(
    controls,
    'skinToneRuntimeProof',
    'private-raw-preview-export',
    'skin-tone controls did not expose runtime proof status.',
  );
  assertData(controls, 'targetHue', '24', 'skin-tone controls did not expose target hue.');
  assertData(controls, 'targetSaturation', '0.38', 'skin-tone controls did not expose target saturation.');
  assertData(controls, 'targetLuminance', '0.56', 'skin-tone controls did not expose target luminance.');
  assertNumericDataGreaterThan(
    controls,
    'inspectorImprovement',
    0,
    'skin-tone inspector should show a positive improvement.',
  );
  assertVisibleText(controls, 'Skin tone - sampled uniformity (Experimental)', 'skin-tone controls title missing.');
  assertVisibleText(
    controls,
    'May affect other orange-range colors; not skin detection or Capture One equivalence.',
    'skin-tone warning copy missing.',
  );
  assertVisibleText(controls, 'Render bridge: H', 'skin-tone render bridge preview missing.');
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
  const inspector = getByTestId(container, 'skin-tone-uniformity-inspector');
  const [before, after] = Array.from(inspector.querySelectorAll('span')).map((span) => Number(span.textContent));
  if (!(Number.isFinite(before) && Number.isFinite(after) && after < before)) {
    failures.push(`skin-tone inspector should improve target distance. Before ${before}, after ${after}.`);
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
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: window.HTMLButtonElement });
  Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: window.HTMLInputElement });
  Object.defineProperty(globalThis, 'HTMLSelectElement', { configurable: true, value: window.HTMLSelectElement });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: window.Event });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: window.MouseEvent });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: window.Node });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: window.MutationObserver });
  Object.defineProperty(globalThis, 'PointerEvent', { configurable: true, value: window.PointerEvent ?? window.Event });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
  });
}

function getByTestId<T extends HTMLElement = HTMLElement>(container: Element, testId: string): T {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  assert.ok(element, `missing test id: ${testId}`);
  return element as T;
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

function assertNumericDataGreaterThan(element: HTMLElement, key: string, minimum: number, message: string) {
  const actual = Number(element.dataset[key]);
  if (!(Number.isFinite(actual) && actual > minimum)) {
    failures.push(`${message} Expected > ${minimum}, got ${element.dataset[key] ?? '<missing>'}.`);
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
