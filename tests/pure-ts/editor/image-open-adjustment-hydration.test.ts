import { describe, expect, test } from 'bun:test';
import { editDocumentLayersV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { INITIAL_MASK_CONTAINER } from '../../../src/utils/adjustments';
import {
  createLightroomAiSceneMaskAuthority,
  createLightroomAiSceneMaskContainer,
} from '../../../src/utils/ai/lightroomAiSceneMaskGeneration';
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

  test('rehydrates an incomplete layer artifact without dropping typed scene masks', () => {
    const imagePath = '/fixtures/scene-mask-reopen.raw';
    const adjustmentLayer = {
      ...structuredClone(INITIAL_MASK_CONTAINER),
      id: 'adjustment-layer-1',
      name: 'Adjustment Layer 1',
    };
    const sceneMasks = (['subject', 'sky', 'background'] as const).map((capability, index) =>
      createLightroomAiSceneMaskContainer({
        capability,
        result: {
          authority: createLightroomAiSceneMaskAuthority({
            capability,
            cancellationToken: `cancel-${capability}`,
            imageSessionId: 'session-scene-reopen',
            providerId: 'rawengine-local-ai',
            renderRevision: 1,
            requestId: `request-${capability}`,
            sourceAssetIdentity: `${imagePath}:6000x4000`,
            sourceGraphRevision: 'adjustment:1',
          }),
          generatedMaskArtifactId: `artifact-${capability}`,
          generatedMaskCoverage: 0.5 + index / 10,
          parameters: {},
        },
        imageDimensions: { height: 4000, width: 6000 },
      }),
    );
    const sceneLayers = editDocumentLayersV2Schema.parse({ masks: [adjustmentLayer, ...sceneMasks] });
    const document = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', sceneLayers);
    const sidecar = buildLayerStackSidecarFromMasks([adjustmentLayer], {
      graphRevision: 'reopen-scene-1',
      imagePath,
      operationId: 'reopen-scene-1',
      sessionId: 'reopen-scene-test',
    });
    const persisted = persistLayerStackSidecarInEditDocumentCandidate(document, [adjustmentLayer], sidecar);
    const reopened = hydrateImageOpenEditDocumentV2(
      { editDocumentV2: { ...document, extensions: { rawEngineArtifacts: persisted.rawEngineArtifacts } } },
      imagePath,
    );

    expect(reopened.layers.masks.map((mask) => mask.name)).toEqual([
      'Adjustment Layer 1',
      'Subject mask',
      'Sky mask',
      'Background mask',
    ]);
    expect(reopened.nodes['layers']?.params['masks']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: adjustmentLayer.id }),
        expect.objectContaining({ id: sceneMasks[0]?.id }),
        expect.objectContaining({ id: sceneMasks[1]?.id }),
        expect.objectContaining({ id: sceneMasks[2]?.id }),
      ]),
    );
  });
});
