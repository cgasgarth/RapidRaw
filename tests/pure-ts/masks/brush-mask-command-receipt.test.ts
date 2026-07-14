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

  test('accepts a second Alt-inverted stroke after the first receipt is attached', () => {
    const context = {
      expectedGraphRevision: 'graph:brush-2',
      imagePath: '/raws/alaska/_DSC7509.ARW',
      imageSize: { height: 360, width: 640 },
      maskId: 'mask-1',
      maskName: 'Brush mask',
      operationId: 'mask-1-2',
      sessionId: 'test-session',
    };
    const paint = {
      brushSize: 96,
      feather: 0.64,
      points: [
        { x: 130, y: 170 },
        { x: 430, y: 170 },
      ],
      tool: 'brush' as const,
    };
    const firstReceipt = buildBrushMaskCommandReceiptFromParameters({ lines: [paint] }, context, { dryRun: true });
    const erase = {
      ...paint,
      points: [
        { pressure: 0.4, x: 300, y: 95 },
        { pressure: 0.8, x: 300, y: 250 },
      ],
      tool: 'eraser' as const,
    };
    const secondReceipt = buildBrushMaskCommandReceiptFromParameters(
      {
        lines: [paint, erase],
        rawEngine: { brushMaskCommandReceipt: firstReceipt },
      },
      context,
      { dryRun: true },
    );

    expect(secondReceipt.strokeCount).toBe(2);
    expect(secondReceipt.lastStrokeMode).toBe('erase');
    expect(secondReceipt.pressurePointCount).toBe(2);
    expect(secondReceipt.command.parameters.strokes.map((stroke) => stroke.mode)).toEqual(['paint', 'erase']);
  });
});
