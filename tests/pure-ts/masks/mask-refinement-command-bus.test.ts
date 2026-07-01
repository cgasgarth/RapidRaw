import { expect, test } from 'bun:test';

import {
  createMaskRefinementCommand,
  dispatchMaskRefinementCommand,
  readMaskRefinementReplayReceipt,
} from '../../../src/utils/mask/maskRefinementCommandBus';

test('mask refinement command preserves unchanged runtime fields and applies inspector changes', () => {
  const command = createMaskRefinementCommand(
    'mask-1',
    {
      density: 0.8,
      edgeContrast: 0.25,
      edgeShiftPx: -6,
      featherPx: 18,
      hairDetail: 0,
      smoothness: 0.1,
    },
    {
      density: 0.65,
      edgeShiftPx: 4,
      smoothness: 0.35,
    },
  );

  expect(command).toEqual({
    commandType: 'layerMask.refineMask',
    parameters: {
      maskId: 'mask-1',
      refinement: {
        density: 0.65,
        edgeContrast: 0.25,
        edgeShiftPx: 4,
        featherPx: 18,
        hairDetail: 0,
        smoothness: 0.35,
      },
    },
    schemaVersion: 1,
  });
});

test('mask refinement dispatch writes replayable parameters for renderer payloads', () => {
  const command = createMaskRefinementCommand('mask-2', {}, { featherPx: 24, edgeContrast: 0.5 });
  const parameters = dispatchMaskRefinementCommand(command);

  expect(parameters).toMatchObject({
    density: 1,
    edgeContrast: 0.5,
    edgeShiftPx: 0,
    featherPx: 24,
    hairDetail: 0,
    smoothness: 0,
  });

  expect(readMaskRefinementReplayReceipt(parameters)).toEqual({
    density: 1,
    edgeContrast: 0.5,
    edgeShiftPx: 0,
    featherPx: 24,
    hairDetail: 0,
    maskId: 'mask-2',
    receiptVersion: 1,
    schemaVersion: 1,
    smoothness: 0,
  });
});
