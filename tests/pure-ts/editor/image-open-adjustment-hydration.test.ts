import { describe, expect, test } from 'bun:test';

import { hydrateImageOpenAdjustments } from '../../../src/utils/imageOpenAdjustmentHydration';

describe('image-open adjustment hydration', () => {
  test('retains persisted guided perspective evidence at the decoded-result fallback boundary', () => {
    const adjustments = hydrateImageOpenAdjustments(
      {
        adjustments: {
          perspectiveCorrection: {
            amount: 75,
            cropPolicy: 'auto_crop',
            guides: [
              {
                class: 'vertical',
                endpointsSourceNormalized: [
                  [0.2, 0.1],
                  [0.3, 0.9],
                ],
                id: 'vertical-1',
                weight: 1,
              },
            ],
            mode: 'guided',
            resolvedPlan: null,
          },
        },
      },
      '/photos/building.arw',
    );

    expect(adjustments.perspectiveCorrection.mode).toBe('guided');
    expect(adjustments.perspectiveCorrection.amount).toBe(75);
    expect(adjustments.perspectiveCorrection.guides).toHaveLength(1);
  });

  test('uses safe defaults for an explicit null adjustment snapshot', () => {
    const adjustments = hydrateImageOpenAdjustments({ adjustments: { is_null: true } }, '/photos/new.arw');

    expect(adjustments.perspectiveCorrection.mode).toBe('off');
    expect(adjustments.perspectiveCorrection.guides).toEqual([]);
  });
});
