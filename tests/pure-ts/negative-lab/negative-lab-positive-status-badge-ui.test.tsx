import { describe, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { NegativeLabPositiveStatusBadge } from '../../../src/components/panel/right/metadata/MetadataPanel.tsx';
import en from '../../../src/i18n/locales/en.json';
import type { NegativeLabReopenedPositiveArtifactStatus } from '../../../src/utils/negative-lab/negativeLabSavedPositiveReopen.ts';

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
  const i18n = await createTestI18n();
  const { container } = render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(NegativeLabPositiveStatusBadge, {
        status,
      }),
    ),
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
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
