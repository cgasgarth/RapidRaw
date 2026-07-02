import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { NegativeLabPositiveProvenanceSurface } from '../../../src/components/panel/right/metadata/MetadataPanel.tsx';
import en from '../../../src/i18n/locales/en.json';
import {
  buildNegativeLabReopenedSavedPositiveArtifactStatus,
  buildNegativeLabReopenedSavedPositiveProvenance,
} from '../../../src/utils/negative-lab/negativeLabSavedPositiveReopen.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (renderedRoot !== null) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }
});

describe('Negative Lab positive provenance surface', () => {
  test('renders persisted source and output paths without modal state', async () => {
    const provenance = buildNegativeLabReopenedSavedPositiveProvenance({
      imagePath: '/roll/frame-001-positive.tif',
      metadata: {
        rawEngineNegativeLabHandoff: {
          artifactId: 'artifact_negative_lab_frame_001',
          conversionBundlePath: '/roll/frame-001-positive.tif.negative-lab-bundle.json',
          dimensions: { height: 1200, width: 1800 },
          frameExposureOverrides: { overrides: [], schemaVersion: 1 },
          frameRgbBalanceOverrides: { overrides: [], schemaVersion: 1 },
          outputArtifactId: 'artifact_negative_lab_frame_001_output',
          outputFormat: 'tiff16',
          outputHash: 'fnv1a64:0123456789abcdef',
          outputPath: '/roll/frame-001-positive.tif',
          path: '/roll/frame-001-positive.tif',
          positiveVariantId: 'positive_variant_frame_001',
          profileProvenanceHash: 'fnv1a32:12345678',
          replayPlanHash: 'fnv1a32:abcdef12',
          selectedAcquisitionProfile: { id: 'camera_raw_linear_v1' },
          selectedProfile: null,
          sidecarPath: '/roll/frame-001-positive.tif.rrdata',
          sourceImageRef: '/roll/frame-001-negative.dng',
          sourcePath: '/roll/frame-001-negative.dng',
        },
      },
    });

    const { root, badge, container } = await renderSurface(provenance, null);
    expect(badge.dataset.negativeLabPositiveState).toBe('current');
    expect(badge.textContent).toBe('NL Current');
    expect(
      container.querySelector('[data-negative-lab-source-path]')?.getAttribute('data-negative-lab-source-path'),
    ).toBe('/roll/frame-001-negative.dng');
    expect(
      container.querySelector('[data-negative-lab-output-path]')?.getAttribute('data-negative-lab-output-path'),
    ).toBe('/roll/frame-001-positive.tif');
    expect(container.textContent).toContain('Negative Lab provenance');
    expect(container.textContent).toContain('Source negative path');
    expect(container.textContent).toContain('Positive output path');
    void root;
  });

  test('renders warning details for stale persisted artifacts', async () => {
    const metadata = {
      rawEngineArtifacts: {
        negativeLabArtifacts: [
          {
            artifactId: 'artifact_negative_lab_frame_001',
            conversion: {
              conversionBundlePath: '/roll/frame-001-positive.tif.negative-lab-bundle.json',
              frameExposureOverrides: { overrides: [], schemaVersion: 1 },
              frameRgbBalanceOverrides: { overrides: [], schemaVersion: 1 },
              outputFormat: 'tiff16',
              profileProvenanceHash: 'fnv1a32:12345678',
              selectedAcquisitionProfile: { id: 'camera_raw_linear_v1' },
              selectedProfile: null,
            },
            outputArtifacts: [
              {
                artifactId: 'artifact_negative_lab_frame_001_output',
                contentHash: 'fnv1a64:0123456789abcdef',
                dimensions: { height: 1200, width: 1800 },
                outputIntent: 'editable_positive',
                path: '/roll/frame-001-positive.tif',
                positiveVariantId: 'positive_variant_frame_001',
              },
            ],
            replay: { identityHash: 'fnv1a32:abcdef12' },
            sidecarPath: '/roll/frame-001-positive.tif.rrdata',
            sourceImageRefs: [{ imagePath: '/roll/frame-001-negative.dng' }],
            staleState: {
              invalidationReasons: ['recipe_hash_changed'],
              state: 'stale',
            },
          },
        ],
        schemaVersion: 1,
        staleArtifactIds: ['artifact_negative_lab_frame_001'],
      },
    };
    const provenance = buildNegativeLabReopenedSavedPositiveProvenance({
      imagePath: '/roll/frame-001-positive.tif',
      metadata,
    });
    const status = buildNegativeLabReopenedSavedPositiveArtifactStatus({
      imagePath: '/roll/frame-001-positive.tif',
      metadata,
    });

    const { badge, container } = await renderSurface(provenance, status);
    expect(badge.dataset.negativeLabPositiveState).toBe('stale');
    expect(container.querySelector('[data-testid="metadata-negative-lab-positive-warning"]')).not.toBeNull();
    expect(
      container.querySelector('[data-negative-lab-warning-reasons]')?.getAttribute('data-negative-lab-warning-reasons'),
    ).toBe('recipe_hash_changed');
    expect(container.textContent).toContain('Persisted warning');
  });
});

async function renderSurface(
  provenance: NonNullable<ReturnType<typeof buildNegativeLabReopenedSavedPositiveProvenance>>,
  status: ReturnType<typeof buildNegativeLabReopenedSavedPositiveArtifactStatus>,
) {
  if (!globalThis.window) {
    const window = new Window();
    Object.assign(globalThis, {
      document: window.document,
      HTMLDivElement: window.HTMLDivElement,
      HTMLElement: window.HTMLElement,
      window,
    });
  }

  if (renderedRoot !== null) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(NegativeLabPositiveProvenanceSurface, {
          provenance,
          status,
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  renderedRoot = { container, root };
  const badge = container.querySelector<HTMLElement>('[data-testid="metadata-negative-lab-positive-status"]');
  if (badge === null) throw new Error('Expected Negative Lab positive status badge to render.');
  return { badge, container, root };
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
