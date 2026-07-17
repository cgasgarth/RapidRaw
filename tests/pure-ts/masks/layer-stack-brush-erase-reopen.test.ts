import { describe, expect, test } from 'bun:test';
import {
  brushMaskV1Schema,
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
import { buildEditorPersistenceRequest } from '../../../src/utils/editorPersistenceEffectRunner';
import { buildLayerStackSidecarFromMasks } from '../../../src/utils/layers/layerStackCommandBridge';
import {
  hydrateLayerStackMasksFromMetadata,
  persistLayerStackSidecarInEditDocumentCandidate,
} from '../../../src/utils/layers/layerStackSidecarAdjustments';

describe('typed brush sidecar reopen', () => {
  test('retains erase mode and density in persisted brush geometry', () => {
    const layer: MaskContainer = {
      adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
      editNodes: createDefaultMaskEditNodes(),
      editNodeSchemaVersion: 1,
      id: 'layer:brush-reopen',
      invert: false,
      name: 'Brush reopen',
      opacity: 100,
      subMasks: [
        {
          id: 'mask:brush-reopen',
          invert: false,
          mode: SubMaskMode.Additive,
          opacity: 100,
          parameters: {
            lines: [
              {
                density: 0.42,
                feather: 36,
                points: [
                  { x: 10, y: 10 },
                  { x: 20, y: 20 },
                ],
                size: 40,
                tool: 'eraser',
              },
            ],
            rawEngine: { height: 100, width: 100 },
          },
          type: Mask.Brush,
          visible: true,
        },
      ],
      visible: true,
    };

    const sidecar = buildLayerStackSidecarFromMasks([layer], {
      graphRevision: 'graph:brush-reopen',
      imagePath: '/fixtures/brush-reopen.raw',
      operationId: 'brush-reopen',
      sessionId: 'test-session',
    });
    const persistedLayer = sidecar.layers[0];
    if (persistedLayer === undefined) throw new Error('Expected persisted layer.');
    const persisted = brushMaskV1Schema.safeParse(persistedLayer.subMasks?.[0]);
    if (!persisted.success) throw new Error('Expected persisted brush mask.');
    expect(persisted.data.strokes[0]?.mode).toBe('erase');
    expect(persisted.data.strokes[0]?.density).toBe(0.42);
  });

  test('round-trips a brush layer through the typed save and reopen envelope', () => {
    const sidecar = buildLayerStackSidecarFromMasks([layerForReopen()], {
      graphRevision: 'graph:brush-reopen-save',
      imagePath: '/fixtures/brush-reopen-save.raw',
      operationId: 'brush-reopen-save',
      sessionId: 'test-session',
    });
    const candidate = persistLayerStackSidecarInEditDocumentCandidate(
      createDefaultEditDocumentV2(),
      [layerForReopen()],
      sidecar,
    );
    const editDocument = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', {
      masks: [],
    });
    // biome-ignore lint/complexity/useLiteralKeys: extension authority is intentionally keyed by schema name.
    editDocument.extensions['rawEngineArtifacts'] = candidate.rawEngineArtifacts;
    const saved = buildEditorPersistenceRequest({
      editDocumentV2: editDocument,
      path: '/fixtures/brush-reopen-save.raw',
    });
    const persistedArtifacts = layerStackSidecarPersistenceEnvelopeV1Schema.parse({
      rawEngineArtifacts: saved.editDocumentV2.extensions['rawEngineArtifacts'],
    }).rawEngineArtifacts;
    if (persistedArtifacts === undefined) throw new Error('Expected persisted layer artifacts.');
    const reopened = hydrateLayerStackMasksFromMetadata(
      { ...structuredClone(INITIAL_ADJUSTMENTS), masks: [] },
      { rawEngineArtifacts: persistedArtifacts },
      '/fixtures/brush-reopen-save.raw',
    );
    const reopenedBrush = reopened.masks[0]?.subMasks[0];
    if (reopenedBrush === undefined) throw new Error('Expected reopened brush mask.');
    expect(reopenedBrush.type).toBe(Mask.Brush);
    // biome-ignore lint/complexity/useLiteralKeys: brush parameters are schema-keyed.
    const reopenedLines = reopenedBrush.parameters?.['lines'];
    if (!Array.isArray(reopenedLines)) throw new Error('Expected reopened brush lines.');
    expect(reopenedLines[0]).toMatchObject({ density: 42, tool: 'eraser' });
  });
});

const layerForReopen = (): MaskContainer => ({
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  editNodes: createDefaultMaskEditNodes(),
  editNodeSchemaVersion: 1,
  id: 'layer:brush-reopen',
  invert: false,
  name: 'Brush reopen',
  opacity: 100,
  subMasks: [
    {
      id: 'mask:brush-reopen',
      invert: false,
      mode: SubMaskMode.Additive,
      opacity: 100,
      parameters: {
        lines: [
          {
            density: 0.42,
            feather: 36,
            points: [
              { x: 10, y: 10 },
              { x: 20, y: 20 },
            ],
            size: 40,
            tool: 'eraser',
          },
        ],
        rawEngine: { height: 100, width: 100 },
      },
      type: Mask.Brush,
      visible: true,
    },
  ],
  visible: true,
});
