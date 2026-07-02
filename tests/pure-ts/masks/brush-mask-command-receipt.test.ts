import { describe, expect, test } from 'bun:test';

import { BrushMaskCommandRuntime, layerMaskCommandEnvelopeV1Schema } from '../../../packages/rawengine-schema/src';
import {
  BRUSH_MASK_COMMAND_COORDINATE_SPACE,
  buildBrushMaskCommandReceiptFromParameters,
} from '../../../src/utils/mask/brushMaskCommandBridge';

describe('brush mask command receipt', () => {
  test('builds a shared-schema-valid command receipt and dry-run runtime result', () => {
    const receipt = buildBrushMaskCommandReceiptFromParameters(
      {
        flow: 40,
        lines: [
          {
            brushSize: 6,
            feather: 0.25,
            flow: 50,
            points: [
              { pressure: 0.2, x: 2, y: 2 },
              { pressure: 0.8, x: 8, y: 9 },
            ],
            tool: 'brush',
          },
        ],
      },
      {
        expectedGraphRevision: 'test-graph-revision',
        imagePath: '/raws/alaska/_DSC7509.ARW',
        imageSize: { height: 16, width: 16 },
        maskId: 'mask-1',
        maskName: 'Brush mask',
        operationId: 'mask-1-1',
        sessionId: 'test-session',
      },
      { dryRun: true },
    );

    expect(layerMaskCommandEnvelopeV1Schema.parse(receipt.command)).toEqual(receipt.command);
    expect(receipt.commandHash).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(receipt.coordinateSpace).toBe(BRUSH_MASK_COMMAND_COORDINATE_SPACE);
    expect(receipt.imagePath).toBe('/raws/alaska/_DSC7509.ARW');
    expect(receipt.maskId).toBe('mask-1');
    expect(receipt.operationId).toBe('mask-1-1');
    expect(receipt.pressurePointCount).toBe(2);
    expect(receipt.strokeCount).toBe(1);
    expect(receipt.validationStatus).toBe('shared-schema-valid');

    const runtime = new BrushMaskCommandRuntime();
    const result = runtime.dispatch(receipt.command, {
      baseMask: {
        alpha: Array.from({ length: 16 * 16 }, () => 0),
        height: 16,
        maskId: 'mask-1',
        width: 16,
      },
      height: 16,
      width: 16,
    });

    expect(result.commandId).toBe(receipt.commandId);
    expect(result.dryRun).toBe(true);
    expect(result.maskArtifacts[0]?.contentHash).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(result.parameterDiff[0]?.value).toMatchObject({
      provenance: {
        pressurePointCount: 2,
        pressureUsed: true,
      },
      strokeCount: 1,
    });
  });
});
