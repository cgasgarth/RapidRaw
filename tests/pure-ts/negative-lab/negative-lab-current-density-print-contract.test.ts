import { describe, expect, test } from 'bun:test';

import { negativeLabPresetParamsSchema } from '../../../src/schemas/negative-lab/negativeLabPresetCatalogSchemas';
import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from '../../../src/utils/negative-lab/negativeLabPresetCatalog';

const currentParams = NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets[0]?.params;

if (currentParams === undefined) {
  throw new Error('Negative Lab contract proof requires a built-in current preset.');
}

describe('current Negative Lab density-print contract', () => {
  test('every built-in emits the complete current conversion identity', () => {
    for (const preset of NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets) {
      const parsed = negativeLabPresetParamsSchema.parse(preset.params);

      expect(parsed.conversion_model).toBe('negative_log_density_v1');
      expect(parsed.print_curve_algorithm).toBe('negative_density_print_v2');
      expect(parsed.print_curve_v2.schema_version).toBe(2);
      expect(parsed.print_curve_v2.output_domain).toBe('scene_linear_print');
    }
  });

  test('legacy conversion identities are rejected instead of promoted', () => {
    const legacy = {
      ...currentParams,
      conversion_model: 'density_rgb_v1',
      print_curve_algorithm: 'density_rgb_v1',
      print_curve_v2: null,
    };

    expect(negativeLabPresetParamsSchema.safeParse(legacy).success).toBe(false);
    expect(legacy).toEqual({
      ...currentParams,
      conversion_model: 'density_rgb_v1',
      print_curve_algorithm: 'density_rgb_v1',
      print_curve_v2: null,
    });
  });

  test('missing current identity and H&D fields stay invalid without defaults', () => {
    for (const field of [
      'conversion_model',
      'print_curve_algorithm',
      'print_curve_output_tag',
      'print_curve_v2',
    ] as const) {
      const incomplete = { ...currentParams } as Record<string, unknown>;
      delete incomplete[field];

      expect(negativeLabPresetParamsSchema.safeParse(incomplete).success).toBe(false);
      expect(field in incomplete).toBe(false);
    }

    for (const field of Object.keys(currentParams.print_curve_v2)) {
      const incompleteCurve = { ...currentParams.print_curve_v2 } as Record<string, unknown>;
      delete incompleteCurve[field];
      const incomplete = { ...currentParams, print_curve_v2: incompleteCurve };

      expect(negativeLabPresetParamsSchema.safeParse(incomplete).success).toBe(false);
      expect(field in incompleteCurve).toBe(false);
    }
  });

  test('duplicate H&D receipt aliases cannot diverge from native-authoritative values', () => {
    for (const printCurveOverride of [
      { contrast_grade: currentParams.print_curve_v2.contrast_grade + 0.1 },
      { target_black_density: currentParams.print_curve_v2.target_black_density + 0.1 },
      { target_white_density: currentParams.print_curve_v2.target_white_density + 0.01 },
    ]) {
      expect(
        negativeLabPresetParamsSchema.safeParse({
          ...currentParams,
          print_curve_v2: { ...currentParams.print_curve_v2, ...printCurveOverride },
        }).success,
      ).toBe(false);
    }
  });
});
