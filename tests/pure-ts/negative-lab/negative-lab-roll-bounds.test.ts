import { describe, expect, test } from 'bun:test';
import { negativeLabRollBoundsReceiptSchema } from '../../../src/schemas/negative-lab/negativeLabRollBoundsSchemas.ts';
import { finalBoundsForFrame } from '../../../src/utils/negative-lab/negativeLabRollBounds.ts';

const bounds = (scale: number) => ({
  axisBounds: {
    color: { max: 0.2 * scale, min: -0.2 * scale },
    luma: { max: 1 * scale, min: 0.1 * scale },
  },
  channelBounds: {
    b: { max: 1.1 * scale, min: 0.05 * scale },
    g: { max: 1 * scale, min: 0.04 * scale },
    r: { max: 0.9 * scale, min: 0.03 * scale },
  },
});

describe('negative lab roll bounds contract', () => {
  test('selects immutable per-frame final bounds from a native receipt', () => {
    const rollBounds = bounds(1);
    const receipt = negativeLabRollBoundsReceiptSchema.parse({
      algorithmId: 'native_negative_lab_roll_bounds_v1',
      analysisVersion: 'fixed_grid_block_median_luma_color_v1',
      frameResults: [
        {
          anchor: true,
          eligible: true,
          finalBounds: bounds(1.05),
          frameId: 'frame-1',
          localBounds: bounds(0.9),
          rollBounds,
        },
      ],
      planHash: `sha256:${'a'.repeat(64)}`,
      rollBounds,
      schemaVersion: 1,
      sourceInterpretationHash: `sha256:${'b'.repeat(64)}`,
      useRollColour: true,
      useRollLuma: false,
      warningCodes: ['single_frame_identity_plan'],
    });

    expect(finalBoundsForFrame(receipt, 'frame-1')).toEqual(bounds(1.05));
    expect(finalBoundsForFrame(receipt, 'missing')).toBeNull();
  });
});
