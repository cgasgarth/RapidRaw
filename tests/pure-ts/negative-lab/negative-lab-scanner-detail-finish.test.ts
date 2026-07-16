import { describe, expect, test } from 'bun:test';

import { negativeLabPresetParamsSchema } from '../../../src/schemas/negative-lab/negativeLabPresetCatalogSchemas';
import { DEFAULT_NEGATIVE_LAB_UI_PRESET } from '../../../src/utils/negative-lab/negativeLabPresetCatalog';

describe('Negative Lab scanner detail finish contract', () => {
  const baseParams = {
    ...DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
  };

  test('defaults to an exact disabled, versioned finish', () => {
    const parsed = negativeLabPresetParamsSchema.parse(baseParams);
    expect(parsed.detail_finish).toEqual(undefined);
  });

  test('preserves normalized radii and rejects out-of-domain values', () => {
    const parsed = negativeLabPresetParamsSchema.parse({
      ...baseParams,
      detail_finish: {
        enabled: true,
        local_contrast_amount: 0.4,
        local_contrast_radius: 0.02,
        sharpening_amount: 0.7,
        sharpening_radius: 0.005,
      },
    });
    expect(parsed.detail_finish?.scale_basis).toBe('full_resolution_short_edge_v1');
    expect(parsed.detail_finish?.working_space).toBe('scene_linear_luminance_v1');
    expect(() =>
      negativeLabPresetParamsSchema.parse({
        ...baseParams,
        detail_finish: { local_contrast_radius: 0.5 },
      }),
    ).toThrow();
  });
});
