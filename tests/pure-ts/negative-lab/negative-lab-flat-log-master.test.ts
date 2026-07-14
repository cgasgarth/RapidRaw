import { describe, expect, test } from 'bun:test';

import { negativeLabAppServerCommandSchema } from '../../../src/schemas/negative-lab/negativeLabAppServerSchemas';
import {
  negativeLabFlatLogMasterParamsSchema,
  negativeLabPresetParamsSchema,
} from '../../../src/schemas/negative-lab/negativeLabPresetCatalogSchemas';

const command = {
  outputFormat: 'tiff16' as const,
  paths: ['/tmp/negative.tif'],
  presetId: 'negative_lab.generic.c41.neutral.v1',
  sampleRect: null,
  scope: 'active' as const,
  suffix: 'Positive',
};

describe('Negative Lab flat-log master intent', () => {
  test('defaults to print and bounded flat-log parameters', () => {
    const parsed = negativeLabAppServerCommandSchema.parse(command);
    expect(parsed.renderIntent).toBe('print');
    expect(parsed.flatLogMaster).toEqual({ algorithmVersion: 1, gain: 1, lift: 0.02 });
    expect(negativeLabFlatLogMasterParamsSchema.parse({})).toEqual({ algorithm_version: 1, gain: 1, lift: 0.02 });
  });

  test('preserves positive flat-log lift/gain in the recipe contract', () => {
    const params = negativeLabPresetParamsSchema.parse({
      blue_weight: 1,
      contrast: 1,
      exposure: 0,
      green_weight: 1,
      red_weight: 1,
      render_intent: 'flat_log_master',
      flat_log_master: { algorithm_version: 1, gain: 0.8, lift: 0.1 },
    });
    expect(params.render_intent).toBe('flat_log_master');
    expect(params.flat_log_master).toEqual({ algorithm_version: 1, gain: 0.8, lift: 0.1 });
  });

  test('carries flat-log intent and TIFF16 output together in app-server commands', () => {
    const parsed = negativeLabAppServerCommandSchema.parse({
      ...command,
      renderIntent: 'flat_log_master',
    });
    expect(parsed.renderIntent).toBe('flat_log_master');
    expect(parsed.outputFormat).toBe('tiff16');
  });
});
