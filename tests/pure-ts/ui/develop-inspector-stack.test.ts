import { describe, expect, test } from 'bun:test';

import {
  DEVELOP_INSPECTOR_SECTION_ORDER,
  DEVELOP_INSPECTOR_STACK_ORDER,
  normalizeDevelopInspectorSectionIds,
  readDevelopInspectorSoloMode,
  saveDevelopInspectorSoloMode,
} from '../../../src/utils/developInspectorStack';

describe('Develop inspector stack', () => {
  test('keeps the canonical Lightroom-style editable order', () => {
    expect(DEVELOP_INSPECTOR_SECTION_ORDER).toEqual([
      'basic',
      'curves',
      'colorMixer',
      'colorGrading',
      'details',
      'lensCorrection',
      'transform',
      'effects',
      'calibration',
    ]);
    expect(DEVELOP_INSPECTOR_STACK_ORDER).toEqual([
      'histogram',
      'toolStrip',
      'basic',
      'curves',
      'colorMixer',
      'colorGrading',
      'details',
      'lensCorrection',
      'transform',
      'effects',
      'calibration',
    ]);
  });

  test('normalizes persisted IDs without allowing unknowns or duplicates', () => {
    expect(normalizeDevelopInspectorSectionIds(['details', 'unknown', 'details', 'basic', 'colorMixer'])).toEqual([
      'details',
      'basic',
      'colorMixer',
    ]);
  });

  test('persists Solo Mode when session storage is available', () => {
    const values = new Map<string, string>();
    const storage: Storage = {
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
      removeItem: (key) => {
        values.delete(key);
      },
      setItem: (key, value) => {
        values.set(key, value);
      },
    };

    expect(readDevelopInspectorSoloMode(storage)).toBe(false);
    saveDevelopInspectorSoloMode(true, storage);
    expect(readDevelopInspectorSoloMode(storage)).toBe(true);
    saveDevelopInspectorSoloMode(false, storage);
    expect(readDevelopInspectorSoloMode(storage)).toBe(false);
  });
});
