import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { NegativeLabPositiveStatusBadge } from '../../../src/components/panel/right/metadata/MetadataPanel.tsx';
import en from '../../../src/i18n/locales/en.json';
import type { NegativeLabReopenedPositiveArtifactStatus } from '../../../src/utils/negative-lab/negativeLabSavedPositiveReopen.ts';

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

describe('Negative Lab positive status badge UI', () => {
  test('visibly distinguishes current, stale, and missing persisted positive artifacts', async () => {
    const current = await renderBadge(buildStatus({ state: 'current' }));
    expect(current.badge.dataset.negativeLabPositiveState).toBe('current');
    expect(current.badge.textContent).toBe('NL Current');
    expect(current.badge.dataset.tooltip).toContain('matches persisted provenance');

    const stale = await renderBadge(buildStatus({ invalidationReasons: ['recipe_hash_changed'], state: 'stale' }));
    expect(stale.badge.dataset.negativeLabPositiveState).toBe('stale');
    expect(stale.badge.textContent).toBe('NL Stale');
    expect(stale.badge.dataset.negativeLabPositiveReasons).toBe('recipe_hash_changed');
    expect(stale.badge.dataset.tooltip).toContain('accepted dry-run plan changed');

    const missing = await renderBadge(
      buildStatus({ invalidationReasons: ['output_artifact_missing'], state: 'missing' }),
    );
    expect(missing.badge.dataset.negativeLabPositiveState).toBe('missing');
    expect(missing.badge.textContent).toBe('NL Missing');
    expect(missing.badge.dataset.negativeLabPositiveReasons).toBe('output_artifact_missing');
    expect(missing.badge.dataset.tooltip).toContain('output artifact missing');
  });
});

const buildStatus = ({
  invalidationReasons = [],
  state,
}: {
  invalidationReasons?: string[];
  state: NegativeLabReopenedPositiveArtifactStatus['state'];
}): NegativeLabReopenedPositiveArtifactStatus => ({
  artifactId: `artifact_negative_lab_${state}`,
  invalidationReasons,
  outputArtifactId: `artifact_negative_lab_${state}_output`,
  outputPath: `/roll/frame-001-${state}.tif`,
  positiveVariantId: `positive_variant_${state}`,
  sourceImageRef: '/roll/frame-001-negative.dng',
  state,
});

async function renderBadge(status: NegativeLabReopenedPositiveArtifactStatus) {
  if (!globalThis.window) {
    const window = new Window();
    globalThis.window = window as unknown as Window & typeof globalThis;
    globalThis.document = window.document as unknown as Document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.HTMLDivElement = window.HTMLDivElement;
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
        createElement(NegativeLabPositiveStatusBadge, {
          status,
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  renderedRoot = { container, root };
  const badge = container.querySelector<HTMLElement>('[data-testid="metadata-negative-lab-positive-status"]');
  if (badge === null) throw new Error('Expected Negative Lab positive status badge to render.');
  return { badge, container };
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
