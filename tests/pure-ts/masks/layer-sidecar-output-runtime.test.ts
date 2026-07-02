import { expect, test } from 'bun:test';

import { INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../../../src/utils/adjustments.ts';
import type { LayerRgbPixel } from '../../../src/utils/layers/layerPreviewExportParity.ts';
import {
  buildLayerSidecarPreviewExportRuntimePlan,
  renderLayerSidecarExportStack,
  renderLayerSidecarPreviewStack,
} from '../../../src/utils/layers/layerSidecarPreviewExportRuntime.ts';
import { applyLayerStackCommandBridgeOperation } from '../../../src/utils/layers/layerStackCommandBridge.ts';

const basePixels: Array<LayerRgbPixel> = [
  { b: 160, g: 140, r: 120 },
  { b: 80, g: 64, r: 48 },
];
const layerPixels: Array<LayerRgbPixel> = [
  { b: 64, g: 96, r: 200 },
  { b: 200, g: 192, r: 128 },
];

const makeLayer = (overrides: Partial<MaskContainer> = {}): MaskContainer => ({
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  blendMode: 'multiply',
  id: 'sidecar-opacity-layer',
  invert: false,
  name: 'Sidecar opacity layer',
  opacity: 100,
  subMasks: [],
  visible: true,
  ...overrides,
});

const bridgeContext = (operationId: string, graphRevision = 'graph-issue-4798') => ({
  graphRevision,
  imagePath: '/proof/issue-4798-sidecar-opacity.raw',
  operationId,
  sessionId: 'session-issue-4798',
});

test('sidecar-backed multiply opacity changes preview and export pixels deterministically', () => {
  const layer = makeLayer();
  const fullOpacitySidecar = applyLayerStackCommandBridgeOperation(
    [layer],
    { layerId: layer.id, opacity: 100, type: 'setOpacity' },
    bridgeContext('full_opacity'),
  ).sidecar;
  const halfOpacitySidecar = applyLayerStackCommandBridgeOperation(
    [layer],
    { layerId: layer.id, opacity: 50, type: 'setOpacity' },
    bridgeContext('half_opacity'),
  ).sidecar;

  const runtimeInput = {
    basePixels,
    height: 1,
    layerPixelsById: { [layer.id]: layerPixels },
    sidecar: halfOpacitySidecar,
    width: 2,
  };
  const preview = renderLayerSidecarPreviewStack(runtimeInput);
  const exportRender = renderLayerSidecarExportStack(runtimeInput);

  expect(fullOpacitySidecar.layers[0]?.opacity).toBe(1);
  expect(halfOpacitySidecar.layers[0]?.opacity).toBe(0.5);
  expect(preview.warnings).toEqual([]);
  expect(preview.coverageByLayer).toEqual([{ id: layer.id, opacity: 0.5, touchedPixels: 2 }]);
  expect(preview.pixels).toEqual([
    { b: 100, g: 96, r: 107 },
    { b: 71, g: 56, r: 36 },
  ]);
  expect(exportRender.pixels).toEqual(preview.pixels);

  const before = renderLayerSidecarPreviewStack({
    ...runtimeInput,
    sidecar: fullOpacitySidecar,
  });
  expect(before.pixels).toEqual([
    { b: 40, g: 53, r: 94 },
    { b: 63, g: 48, r: 24 },
  ]);
  expect(before.pixels).not.toEqual(preview.pixels);
});

test('sidecar-backed unsupported blend modes are warned and left unchanged', () => {
  const layer = makeLayer({ blendMode: 'overlay', id: 'unsupported-overlay-layer' });
  const sidecar = applyLayerStackCommandBridgeOperation(
    [layer],
    { layerId: layer.id, opacity: 65, type: 'setOpacity' },
    bridgeContext('unsupported_overlay'),
  ).sidecar;

  const plan = buildLayerSidecarPreviewExportRuntimePlan({
    basePixels,
    height: 1,
    layerPixelsById: { [layer.id]: layerPixels },
    sidecar,
    width: 2,
  });
  const preview = renderLayerSidecarPreviewStack({
    basePixels,
    height: 1,
    layerPixelsById: { [layer.id]: layerPixels },
    sidecar,
    width: 2,
  });

  expect(plan.input.layers).toEqual([]);
  expect(plan.skippedLayerIds).toEqual([layer.id]);
  expect(plan.warnings).toEqual([
    {
      code: 'unsupported_blend_mode',
      layerId: layer.id,
      message: 'Layer unsupported-overlay-layer uses unsupported sidecar output blend mode "overlay".',
    },
  ]);
  expect(preview.pixels).toEqual(basePixels);
  expect(preview.coverageByLayer).toEqual([]);
});
