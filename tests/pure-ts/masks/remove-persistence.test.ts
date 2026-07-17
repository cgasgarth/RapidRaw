import { describe, expect, test } from 'bun:test';

import {
  editDocumentLayersV2Schema,
  layerStackSidecarPersistenceEnvelopeV1Schema,
} from '../../../packages/rawengine-schema/src';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import {
  createDefaultMaskEditNodes,
  INITIAL_ADJUSTMENTS,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import {
  buildEditorPersistenceRequest,
  editorPersistenceRequestSchema,
} from '../../../src/utils/editorPersistenceEffectRunner';
import { buildLayerStackSidecarFromMasks } from '../../../src/utils/layers/layerStackCommandBridge';
import {
  hydrateLayerStackMasksFromMetadata,
  persistLayerStackSidecarInEditDocumentCandidate,
} from '../../../src/utils/layers/layerStackSidecarAdjustments';

const removeLayer = (): MaskContainer => ({
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  editNodes: createDefaultMaskEditNodes(),
  editNodeSchemaVersion: 1,
  id: 'layer:remove-persistence',
  invert: false,
  name: 'Remove persistence',
  opacity: 100,
  retouchRemoveSource: {
    featherRadiusPx: 24,
    generator: 'local_patch_fill_v1',
    generatorVersion: 1,
    radiusPx: 48,
    resolvedSourcePoint: { pressure: 0.8, x: 0.22, y: 0.34 },
    searchRadiusMultiplier: 4,
    seed: 7,
    status: 'ready',
    targetMaskId: 'mask:remove-persistence',
  },
  subMasks: [
    {
      id: 'mask:remove-persistence',
      invert: false,
      mode: SubMaskMode.Additive,
      name: 'Remove target',
      opacity: 100,
      parameters: { centerX: 100, centerY: 100, featherRadiusPx: 24, radiusPx: 48 },
      type: Mask.Radial,
      visible: true,
    },
  ],
  visible: true,
});

describe('typed Remove persistence boundary', () => {
  test('sends only the native current Remove projection to save_metadata_and_update_thumbnail', () => {
    const layer = removeLayer();
    const document = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', {
      masks: editDocumentLayersV2Schema.parse({ masks: [layer] }).masks,
    });
    const request = buildEditorPersistenceRequest({
      editDocumentV2: document,
      path: '/fixtures/remove-persistence.raw',
    });
    const savedLayer = request.editDocumentV2.layers.masks[0];
    if (savedLayer === undefined || savedLayer.retouchRemoveSource === undefined) {
      throw new Error('Expected a persisted Remove layer.');
    }

    expect(savedLayer.retouchRemoveSource).toEqual({
      featherRadiusPx: 24,
      radiusPx: 48,
      resolvedSourcePoint: { x: 0.22, y: 0.34 },
    });
    expect(savedLayer.retouchRemoveSource).not.toHaveProperty('generator');
    expect(savedLayer.retouchRemoveSource).not.toHaveProperty('generatorVersion');
    expect(savedLayer.retouchRemoveSource).not.toHaveProperty('targetMaskId');
    expect(request.editDocumentV2.nodes['layers']?.params).toEqual(request.editDocumentV2.layers);
    expect(editorPersistenceRequestSchema.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
  });

  test('round-trips full Remove workflow metadata through the layer sidecar while reopening the native projection', () => {
    const layer = removeLayer();
    const initial = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', {
      masks: editDocumentLayersV2Schema.parse({ masks: [layer] }).masks,
    });
    const sidecar = buildLayerStackSidecarFromMasks([layer], {
      graphRevision: 'graph:remove-persistence',
      imagePath: '/fixtures/remove-persistence.raw',
      operationId: 'remove-persistence',
      sessionId: 'remove-persistence-session',
    });
    const candidate = persistLayerStackSidecarInEditDocumentCandidate(initial, [layer], sidecar);
    const document = structuredClone(initial);
    // biome-ignore lint/complexity/useLiteralKeys: extension authority is intentionally keyed by schema name.
    document.extensions['rawEngineArtifacts'] = candidate.rawEngineArtifacts;
    const request = buildEditorPersistenceRequest({
      editDocumentV2: document,
      path: '/fixtures/remove-persistence.raw',
    });
    const persistedArtifacts = layerStackSidecarPersistenceEnvelopeV1Schema.parse({
      rawEngineArtifacts: request.editDocumentV2.extensions['rawEngineArtifacts'],
    }).rawEngineArtifacts;
    if (persistedArtifacts === undefined) throw new Error('Expected persisted Remove layer artifacts.');

    const reopened = hydrateLayerStackMasksFromMetadata(
      { ...structuredClone(INITIAL_ADJUSTMENTS), masks: [] },
      { rawEngineArtifacts: persistedArtifacts },
      '/fixtures/remove-persistence.raw',
    );
    const reopenedSource = reopened.masks[0]?.retouchRemoveSource;
    expect(reopenedSource).toMatchObject({
      generator: 'local_patch_fill_v1',
      generatorVersion: 1,
      searchRadiusMultiplier: 4,
      seed: 7,
      status: 'ready',
      targetMaskId: 'mask:remove-persistence',
    });
    expect(reopenedSource?.resolvedSourcePoint).toEqual({ pressure: 0.8, x: 0.22, y: 0.34 });
  });
});
