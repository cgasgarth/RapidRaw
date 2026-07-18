import { expect, mock, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import LensCorrections from '../../../src/components/adjustments/LensCorrections.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors.ts';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2.ts';

const tauriInvoke = mock(async (_command: string, _args?: unknown) => []);
mock.module('@tauri-apps/api/core', () => ({ invoke: tauriInvoke }));

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

const image = (isRaw: boolean) => ({
  exif: { LensModel: 'FE 35mm F1.8', Make: 'Sony' },
  height: 3000,
  isRaw,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: `/fixture/lens-corrections.${isRaw ? 'ARW' : 'JPG'}`,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4000,
});

function installSession(isRaw = true, lensPatch: Record<string, unknown> = {}) {
  const selectedImage = image(isRaw);
  const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'lens_correction', lensPatch);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 6132,
    lastEditApplicationReceipt: null,
    selectedImage,
    history: [editDocumentV2],
  });
  return { editDocumentV2, selectedImage };
}

function renderPanel() {
  const document = useEditorStore.getState().editDocumentV2;
  const selectedImage = useEditorStore.getState().selectedImage;
  return render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(LensCorrections, {
        adjustments: {
          ...document.geometry,
          ...selectEditDocumentNode(document, 'lens_correction').params,
        },
        selectedImage,
        setAdjustments: () => {
          throw new Error('Lens controls must commit through the canonical transaction.');
        },
      }),
    ),
  );
}

test('Lens Corrections is independent from Transform and exposes truthful profile provenance', async () => {
  installSession(true, {
    lensCorrectionMode: 'auto',
    lensDistortionParams: {
      k1: 0.01,
      k2: -0.002,
      k3: 0,
      model: 1,
      tca_vb: 0.99,
      tca_vr: 1.01,
      vig_k1: 0.02,
      vig_k2: 0,
      vig_k3: 0,
    },
  });
  const view = renderPanel();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(view.container.querySelector('[data-testid="lens-corrections-panel"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="perspective-correction-controls"]')).toBeNull();
  expect(view.container.querySelector('[data-testid="transform-controls"]')).toBeNull();
  expect(view.container.querySelector('[data-testid="manual-chromatic-aberration-controls"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="lens-defringe-advanced"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="lens-profile-provenance"]')?.textContent).toContain('Lensfun');
  expect(view.container.querySelector('[data-lens-input-kind="raw"]')).not.toBeNull();
  view.unmount();
});

test('manual CA commits exactly one current lens transaction', async () => {
  installSession(true);
  const view = renderPanel();
  const redCyan = view.container.querySelector('[data-testid="lens-control-ca-red-cyan-range"]');
  if (!(redCyan instanceof HTMLInputElement)) throw new Error('Expected manual red/cyan range.');

  await act(async () => {
    fireEvent.input(redCyan, { target: { value: '23' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const lensNode = useEditorStore.getState().editDocumentV2.nodes['lens_correction'];
  if (lensNode === undefined) throw new Error('Expected lens node after CA commit.');
  expect(lensNode.params['chromaticAberrationRedCyan']).toBe(23);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:6132',
    source: 'manual-control',
  });
  expect(useEditorStore.getState().history).toHaveLength(2);
  view.unmount();
});

test('non-RAW and missing profiles stay explicit while manual controls remain usable', async () => {
  installSession(false, { lensCorrectionMode: 'auto', lensDistortionParams: null });
  const view = renderPanel();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(view.container.querySelector('[data-lens-input-kind="non-raw"]')).not.toBeNull();
  expect(view.container.querySelector('[data-lens-profile-state="missing"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="lens-profile-provenance"]')?.textContent).toContain('Non-RAW');
  view.unmount();
});

test('RAW missing and manual fallback provenance never masquerade as profile correction', () => {
  installSession(true, { lensCorrectionMode: 'auto', lensDistortionParams: null });
  const missingView = renderPanel();
  expect(missingView.container.querySelector('[data-testid="lens-profile-provenance"]')?.textContent).toContain(
    'RAW profile not found',
  );
  expect(missingView.container.querySelector('[data-testid="lens-profile-provenance"]')?.textContent).not.toContain(
    'RAW profile correction ·',
  );
  missingView.unmount();

  installSession(true, { lensCorrectionMode: 'manual', lensDistortionParams: null });
  const fallbackView = renderPanel();
  expect(fallbackView.container.querySelector('[data-testid="lens-profile-provenance"]')?.textContent).toContain(
    'Manual fallback',
  );
  fallbackView.unmount();
});

test('profile-backed state is marked detected when coefficients are present', () => {
  const lensParams = {
    k1: 0.01,
    k2: -0.002,
    k3: 0,
    model: 1,
    tca_vb: 0.99,
    tca_vr: 1.01,
    vig_k1: 0.02,
    vig_k2: 0,
    vig_k3: 0,
  };
  installSession(true, {
    lensCorrectionMode: 'auto',
    lensDistortionParams: lensParams,
    lensMaker: 'Sony',
    lensModel: 'FE 35mm F1.8',
  });
  const view = renderPanel();
  expect(view.container.querySelector('[data-lens-profile-state="detected"]')).not.toBeNull();
  view.unmount();
});
