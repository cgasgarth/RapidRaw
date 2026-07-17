import { describe, expect, test } from 'bun:test';
import { INITIAL_MASK_CONTAINER } from '../../../src/utils/adjustments';
import { selectEditDocumentGeometry } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import { hydrateImageOpenEditDocumentV2 } from '../../../src/utils/imageOpenAdjustmentHydration';
import { buildLayerStackSidecarFromMasks } from '../../../src/utils/layers/layerStackCommandBridge';
import { persistLayerStackSidecarInEditDocumentCandidate } from '../../../src/utils/layers/layerStackSidecarAdjustments';

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

  test('hydrates masks from artifacts nested in the native edit-document extension', () => {
    const imagePath = '/fixtures/brush.raw';
    const layer = { ...structuredClone(INITIAL_MASK_CONTAINER), id: 'brush-layer-1', name: 'Brush Local Adjustment 1' };
    const document = createDefaultEditDocumentV2();
    const sidecar = buildLayerStackSidecarFromMasks([layer], {
      graphRevision: 'reopen-1',
      imagePath,
      operationId: 'reopen-1',
      sessionId: 'reopen-test',
    });
    const persisted = persistLayerStackSidecarInEditDocumentCandidate(document, [layer], sidecar);
    const reopened = hydrateImageOpenEditDocumentV2(
      { editDocumentV2: { ...document, extensions: { rawEngineArtifacts: persisted.rawEngineArtifacts } } },
      imagePath,
    );

    expect(reopened.layers.masks).toHaveLength(1);
    expect(reopened.layers.masks[0]?.id).toBe(layer.id);
    expect(reopened.nodes['layers']).toMatchObject({ params: { masks: [{ id: layer.id }] } });
  });
});
