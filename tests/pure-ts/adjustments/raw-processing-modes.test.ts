import { expect, test } from 'bun:test';
import i18next from 'i18next';

import {
  buildRawProcessingModePatch,
  getRawProcessingModeDisplayCopy,
  getRawProcessingModeProvenance,
  normalizeRawProcessingMode,
  normalizeRawProcessingModeOverride,
  RAW_PROCESSING_MODE_RECIPES,
} from '../../../src/utils/rawProcessingModes';

test('RAW processing mode recipes map to distinct runtime behavior', () => {
  const fast = buildRawProcessingModePatch('fast');
  const balanced = buildRawProcessingModePatch('balanced');
  const maximum = buildRawProcessingModePatch('maximum');

  expect(fast.forceFastDemosaic).toBe(true);
  expect(fast.rawPreprocessingSharpening).toBe(0);
  expect(fast.rawPreprocessingColorNr).toBe(0);
  expect(balanced.forceFastDemosaic).toBe(false);
  expect(maximum.forceFastDemosaic).toBe(false);
  expect(maximum.rawHighlightCompression).toBeGreaterThan(balanced.rawHighlightCompression);
  expect(maximum.rawPreprocessingSharpening).toBeGreaterThan(balanced.rawPreprocessingSharpening);
  expect(maximum.provenance).toBe('maximum_detail_capture_preprocessing_v1');
});

test('RAW processing mode normalization falls back to balanced', () => {
  expect(normalizeRawProcessingMode('fast')).toBe('fast');
  expect(normalizeRawProcessingMode('unknown')).toBe('balanced');
  expect(normalizeRawProcessingMode(undefined)).toBe('balanced');
  expect(RAW_PROCESSING_MODE_RECIPES.balanced.provenance).toBe('default_quality_capture_preprocessing_v1');
});

test('RAW processing mode display copy stays localized while provenance remains available', async () => {
  const instance = i18next.createInstance();
  await instance.init({
    lng: 'en',
    resources: {
      en: {
        translation: {
          settings: { processing: { rawModes: { balanced: { label: 'Balanced' } } } },
        },
      },
    },
  });

  expect(getRawProcessingModeDisplayCopy('balanced', instance.getFixedT('en'))).toBe('Balanced');
  expect(getRawProcessingModeProvenance('balanced')).toBe('default_quality_capture_preprocessing_v1');
});

test('RAW processing mode override normalization keeps inherit separate from invalid values', () => {
  expect(normalizeRawProcessingModeOverride('maximum')).toBe('maximum');
  expect(normalizeRawProcessingModeOverride('inherit')).toBeNull();
  expect(normalizeRawProcessingModeOverride(undefined)).toBeNull();
});
