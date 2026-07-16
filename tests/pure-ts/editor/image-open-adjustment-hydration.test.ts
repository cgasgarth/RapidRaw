import { describe, expect, test } from 'bun:test';

import { selectEditDocumentGeometry } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import { hydrateImageOpenEditDocumentV2 } from '../../../src/utils/imageOpenAdjustmentHydration';

describe('image-open current-document hydration', () => {
  test('retains persisted guided perspective evidence', () => {
    const document = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'geometry', {
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
    });
    const hydrated = hydrateImageOpenEditDocumentV2({ editDocumentV2: document });
    expect(selectEditDocumentGeometry(hydrated).perspectiveCorrection).toMatchObject({ amount: 75, mode: 'guided' });
  });

  test('uses current defaults when metadata has no document', () => {
    expect(hydrateImageOpenEditDocumentV2({})).toEqual(createDefaultEditDocumentV2());
  });
});
