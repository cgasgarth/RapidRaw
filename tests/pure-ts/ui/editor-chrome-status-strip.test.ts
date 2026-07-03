import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import EditorChromeStatusStrip from '../../../src/components/panel/editor/EditorChromeStatusStrip.tsx';
import type { SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import en from '../../../src/i18n/locales/en.json';
import type { GamutWarningOverlayPayload } from '../../../src/schemas/tauriEventSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { getEditorChromeStatusChips } from '../../../src/utils/color/runtime/gamutWarningDisplay.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const imagePath = '/validation/editor-chrome-status.ARW';
const recipeId = 'display-p3-jpeg';
const transform = {
  blackPointCompensation: 'Unsupported',
  colorManagedTransform: 'moxcms Display P3 Relative Colorimetric 8-bit',
  effectiveColorProfile: 'Display P3',
  effectiveRenderingIntent: 'Relative Colorimetric',
  policyStatus: 'color_managed',
  policyVersion: 'rawengine.export-color-policy.v1',
  sourcePrecisionPath: 'float16-preview',
  transformApplied: true,
  transformPolicyFingerprint: 'sha256:editor-chrome-status-current',
};
const selectedImage: SelectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: imagePath,
  rawDevelopmentReport: null,
  thumbnailUrl: 'data:image/jpeg;base64,AAAA',
  width: 4000,
};
const currentOverlay: GamutWarningOverlayPayload = {
  black_point_compensation: transform.blackPointCompensation,
  color_managed_transform: transform.colorManagedTransform,
  coverage_ratio: 0.125,
  effective_color_profile: transform.effectiveColorProfile,
  effective_rendering_intent: transform.effectiveRenderingIntent,
  export_soft_proof_recipe_id: recipeId,
  height: 180,
  mask_data_url: 'data:image/png;base64,AAAA',
  max_channel_value: 255,
  min_channel_value: 0,
  pixel_count: 360,
  policy_status: transform.policyStatus,
  policy_version: transform.policyVersion,
  preview_basis: 'export_preview',
  source_image_path: imagePath,
  source_precision_path: transform.sourcePrecisionPath,
  transform_applied: transform.transformApplied,
  transform_policy_fingerprint: transform.transformPolicyFingerprint,
  warning_pixel_count: 45,
  width: 240,
};
const currentScope = {
  displayTransformLabel: 'Display P3',
  exportProfileLabel: 'Display P3',
  exportRenderingIntentLabel: 'Relative Colorimetric',
  histogramReady: true,
  path: imagePath,
  renderBasis: 'export_preview' as const,
  softProofTransformApplied: true,
  sourceLabel: 'Export preview',
  updatedAt: '2026-07-02T16:00:00.000Z',
  waveformReady: true,
  workingTransformLabel: 'Working RGB',
  warningCodes: [],
};

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (renderedRoot !== null) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  resetEditorStore();
});

describe('editor chrome status strip', () => {
  test('computes dense clipping, gamut, soft-proof, and scope chips from editor state', () => {
    const chips = getEditorChromeStatusChips({
      adjustments: {
        levels: {
          ...INITIAL_ADJUSTMENTS.levels,
          inputBlack: 0.06,
          inputWhite: 0.92,
        },
      },
      gamutWarningOverlay: currentOverlay,
      previewScopeStatus: currentScope,
      proofContext: {
        exportSoftProofRecipeId: recipeId,
        exportSoftProofTransform: transform,
        isExportSoftProofEnabled: true,
        selectedImagePath: imagePath,
      },
    });

    expect(chips.map((chip) => chip.id)).toEqual([
      'shadow-clipping',
      'highlight-clipping',
      'gamut-warning',
      'soft-proof',
      'preview-scopes',
    ]);
    expect(chips.find((chip) => chip.id === 'shadow-clipping')).toMatchObject({
      active: true,
      state: 'current',
      tone: 'danger',
      value: 'Clipping',
    });
    expect(chips.find((chip) => chip.id === 'highlight-clipping')).toMatchObject({
      active: true,
      state: 'current',
      tone: 'danger',
      value: 'Clipping',
    });
    expect(chips.find((chip) => chip.id === 'gamut-warning')).toMatchObject({
      active: true,
      state: 'current',
      tone: 'warning',
      value: '12.5%',
    });
    expect(chips.find((chip) => chip.id === 'preview-scopes')).toMatchObject({
      active: true,
      state: 'current',
      value: 'current',
    });
  });

  test('renders live store updates and hides in fullscreen', async () => {
    const { container } = await renderStrip(false);

    act(() => {
      useEditorStore.getState().setEditor({
        adjustments: {
          ...INITIAL_ADJUSTMENTS,
          levels: { ...INITIAL_ADJUSTMENTS.levels, inputBlack: 0.04, inputWhite: 0.9 },
        },
        exportSoftProofRecipeId: recipeId,
        exportSoftProofTransform: transform,
        gamutWarningOverlay: currentOverlay,
        isExportSoftProofEnabled: true,
        previewScopeStatus: currentScope,
        selectedImage,
      });
    });

    expect(chip(container, 'shadow-clipping').dataset.active).toBe('true');
    expect(chip(container, 'highlight-clipping').dataset.active).toBe('true');
    expect(chip(container, 'gamut-warning').dataset.value).toBe('12.5%');
    expect(chip(container, 'soft-proof').dataset.state).toBe('current');
    expect(chip(container, 'preview-scopes').dataset.state).toBe('current');

    await rerenderStrip(true);
    const hiddenStrip = container.querySelector<HTMLElement>('[data-testid="editor-chrome-status-strip"]');
    expect(hiddenStrip?.dataset.state).toBe('hidden');
    expect(hiddenStrip?.hidden).toBe(true);
  });
});

async function renderStrip(isFullScreen: boolean) {
  if (!globalThis.window) {
    const window = new Window();
    Object.assign(globalThis, {
      document: window.document,
      HTMLDivElement: window.HTMLDivElement,
      HTMLElement: window.HTMLElement,
      window,
    });
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  renderedRoot = { container, root };
  await rerenderStrip(isFullScreen);
  return { container, root };
}

async function rerenderStrip(isFullScreen: boolean) {
  if (renderedRoot === null) throw new Error('Expected editor chrome status strip root.');

  await act(async () => {
    renderedRoot?.root.render(
      createElement(
        I18nextProvider,
        { i18n: await createTestI18n() },
        createElement(EditorChromeStatusStrip, { isFullScreen }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function chip(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-testid="editor-chrome-status-chip-${id}"]`);
  if (element === null) throw new Error(`Expected ${id} chip to render.`);
  return element;
}

function resetEditorStore() {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    exportSoftProofRecipeId: null,
    exportSoftProofTransform: null,
    gamutWarningOverlay: null,
    isExportSoftProofEnabled: false,
    previewScopeStatus: null,
    selectedImage: null,
  });
}

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: {
      en: {
        translation: en,
      },
    },
  });
  return instance;
}
