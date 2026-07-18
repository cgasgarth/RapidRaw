import { expect, mock, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import EffectsPanel from '../../../src/components/adjustments/Effects.tsx';
import { type AppSettings, Theme } from '../../../src/components/ui/AppProperties.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors.ts';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2.ts';

mock.module('@tauri-apps/api/core', () => ({ invoke: mock(() => Promise.resolve(null)) }));

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

const sourcePath = '/fixture/effects.ARW';

function installSession() {
  const editDocumentV2 = createDefaultEditDocumentV2();
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    history: [editDocumentV2],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 6149,
    lastEditApplicationReceipt: null,
    selectedImage: {
      exif: null,
      height: 100,
      isRaw: true,
      isReady: true,
      metadata: null,
      originalUrl: null,
      path: sourcePath,
      rawDevelopmentReport: null,
      thumbnailUrl: '',
      width: 100,
    },
  });
}

function EffectsPanelHarness({ appSettings }: { appSettings: AppSettings | null }) {
  const document = useEditorStore((state) => state.editDocumentV2);
  return createElement(EffectsPanel, {
    adjustments: {
      ...selectEditDocumentNode(document, 'display_creative').params,
      ...selectEditDocumentNode(document, 'film_emulation').params,
    },
    appSettings,
    handleLutSelect: () => undefined,
    isForMask: false,
    setAdjustments: () => {
      throw new Error('Develop Effects controls must commit through the canonical transaction.');
    },
  });
}

function renderPanel(appSettings: AppSettings | null = null) {
  return render(createElement(I18nextProvider, { i18n }, createElement(EffectsPanelHarness, { appSettings })));
}

test('Develop Effects opens on Vignette and Grain, with creative controls behind Advanced', () => {
  installSession();
  const view = renderPanel();

  const effectsControls = view.container.querySelector('[data-testid="effects-controls"]');
  if (!(effectsControls instanceof HTMLDivElement)) throw new Error('missing Effects controls');

  const defaultControlIds = [
    'effects-control-vignette-amount',
    'effects-control-vignette-midpoint',
    'effects-control-vignette-roundness',
    'effects-control-vignette-feather',
    'effects-control-grain-amount',
    'effects-control-grain-size',
    'effects-control-grain-roughness',
  ];
  for (const testId of defaultControlIds) {
    expect(view.container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
  }

  const vignetteSection = view.container.querySelector('[data-testid="effects-vignette-section"]');
  const grainSection = view.container.querySelector('[data-testid="film-grain-ui-controls"]');
  const summary = view.container.querySelector('[data-testid="effects-active-summary"]');
  const advancedSection = view.container.querySelector('[data-testid="effects-advanced-section"]');
  if (vignetteSection === null || grainSection === null || summary === null || advancedSection === null) {
    throw new Error('missing Effects surface sections');
  }
  expect(vignetteSection.compareDocumentPosition(grainSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(grainSection.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(summary.compareDocumentPosition(advancedSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(view.container.querySelector('[data-testid="effects-advanced"]')).toBeNull();
  expect(view.container.querySelector('[data-testid="effects-advanced-toggle"]')?.getAttribute('aria-expanded')).toBe(
    'false',
  );

  const advancedToggle = view.container.querySelector('[data-testid="effects-advanced-toggle"]');
  if (!(advancedToggle instanceof HTMLButtonElement)) throw new Error('missing Effects advanced toggle');
  act(() => advancedToggle.click());
  expect(view.container.querySelector('[data-testid="effects-advanced"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="effects-control-glow-amount"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="effects-control-flare-amount"]')).not.toBeNull();
  view.unmount();
});

test('Develop Effects honors per-control visibility without moving the remaining default surface', () => {
  installSession();
  const view = renderPanel({
    adjustmentVisibility: { grain: false },
    lastRootPath: null,
    theme: Theme.Dark,
  });

  expect(view.container.querySelector('[data-testid="effects-vignette-section"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="film-grain-ui-controls"]')).toBeNull();
  expect(view.container.querySelector('[data-testid="effects-advanced-toggle"]')).not.toBeNull();
  view.unmount();
});

test('Develop Effects commits direct edits and grain presets as separate undoable transactions', () => {
  installSession();
  const view = renderPanel();
  const vignetteRange = view.container.querySelector(
    '[data-testid="effects-control-vignette-amount"] input[type="range"]',
  );
  if (!(vignetteRange instanceof HTMLInputElement)) throw new Error('missing vignette amount range');

  act(() => {
    fireEvent.input(vignetteRange, { target: { value: '-35' } });
  });
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'display_creative').params.vignetteAmount,
  ).toBe(-35);
  expect(useEditorStore.getState().history).toHaveLength(2);

  const grainRange = view.container.querySelector('[data-testid="effects-control-grain-amount"] input[type="range"]');
  if (!(grainRange instanceof HTMLInputElement)) throw new Error('missing grain amount range');
  act(() => {
    fireEvent.input(grainRange, { target: { value: '24' } });
  });
  expect(selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'display_creative').params.grainAmount).toBe(
    24,
  );
  expect(useEditorStore.getState().history).toHaveLength(3);

  const classicPreset = view.container.querySelector(
    '[data-testid="film-grain-preset-film_grain.ui_preset.iso_400_classic.v1"]',
  );
  if (!(classicPreset instanceof HTMLButtonElement)) throw new Error('missing ISO 400 grain preset');
  act(() => classicPreset.click());
  const displayCreative = selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'display_creative');
  expect(displayCreative.params.grainAmount).toBe(28);
  expect(displayCreative.params.grainSize).toBe(34);
  expect(displayCreative.params.grainRoughness).toBe(50);
  expect(useEditorStore.getState().history).toHaveLength(4);

  const enableToggle = view.container.querySelector('[data-testid="effects-enable-toggle"]');
  if (!(enableToggle instanceof HTMLButtonElement)) throw new Error('missing Effects enable toggle');
  act(() => enableToggle.click());
  expect(selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'display_creative').enabled).toBe(false);
  expect(useEditorStore.getState().history).toHaveLength(5);
  view.unmount();
});
