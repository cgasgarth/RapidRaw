import { describe, expect, test } from 'bun:test';
import { brushMaskV1Schema } from '../../../packages/rawengine-schema/src';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import {
  createDefaultMaskEditNodes,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from '../../../src/utils/adjustments';
import { buildLayerStackSidecarFromMasks } from '../../../src/utils/layers/layerStackCommandBridge';

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
});
