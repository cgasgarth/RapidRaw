import { describe, expect, test } from 'bun:test';

import {
  negativeLabBuiltInUiPresetCatalogSchema,
  negativeLabPresetParamsSchema,
} from '../../../src/schemas/negative-lab/negativeLabPresetCatalogSchemas.ts';
import {
  DEFAULT_NEGATIVE_LAB_UI_PRESET,
  NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG,
} from '../../../src/utils/negative-lab/negativeLabPresetCatalog.ts';

describe('Negative Lab B&W silver process mode', () => {
  test('catalog carries a native process family through params', () => {
    const catalog = negativeLabBuiltInUiPresetCatalogSchema.parse(NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG);
    const bw = catalog.presets.find((preset) => preset.processFamily === 'black_and_white_silver_negative');
    expect(bw).toBeDefined();
    expect(bw?.params.process_family).toBe('black_and_white_silver_negative');
    expect(bw?.params.color_finish?.enabled ?? false).toBe(false);
  });

  test('params reject an unsupported process family and preserve C-41 defaults', () => {
    const color = negativeLabPresetParamsSchema.parse({
      ...DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
    });
    expect(color.process_family).toBe('c41_color_negative');
    expect(() => negativeLabPresetParamsSchema.parse({ ...color, process_family: 'e6_slide_reversal' })).toThrow();
  });
});
