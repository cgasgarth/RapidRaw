import { type LayerStackSidecarV1, layerStackSidecarV1Schema } from '../../../packages/rawengine-schema/src';
import {
  type LayerBlendMode,
  type LayerBlendStackInput,
  type LayerBlendStackLayer,
  type LayerBlendStackRender,
  type LayerRgbPixel,
  renderLayerExportStack,
  renderLayerPreviewStack,
} from './layerPreviewExportParity';

export const SIDECAR_LAYER_OUTPUT_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
] as const satisfies ReadonlyArray<LayerBlendMode>;

export type SidecarLayerOutputBlendMode = (typeof SIDECAR_LAYER_OUTPUT_BLEND_MODES)[number];

export interface LayerSidecarPreviewExportRuntimeInput {
  basePixels: ReadonlyArray<LayerRgbPixel>;
  height: number;
  layerMaskAlphaById?: Readonly<Record<string, ReadonlyArray<number>>>;
  layerPixelsById: Readonly<Record<string, ReadonlyArray<LayerRgbPixel>>>;
  sidecar: LayerStackSidecarV1;
  width: number;
}

export interface LayerSidecarPreviewExportRuntimeWarning {
  code: 'missing_layer_pixels' | 'unsupported_blend_mode';
  layerId: string;
  message: string;
}

export interface LayerSidecarPreviewExportRuntimePlan {
  graphRevision: string;
  input: LayerBlendStackInput;
  skippedLayerIds: Array<string>;
  sourceImagePath: string;
  warnings: Array<LayerSidecarPreviewExportRuntimeWarning>;
}

export interface LayerSidecarPreviewExportRuntimeRender extends LayerBlendStackRender {
  graphRevision: string;
  skippedLayerIds: Array<string>;
  sourceImagePath: string;
  warnings: Array<LayerSidecarPreviewExportRuntimeWarning>;
}

const supportedBlendModes = new Set<string>(SIDECAR_LAYER_OUTPUT_BLEND_MODES);

export function isSidecarLayerOutputBlendMode(value: string): value is SidecarLayerOutputBlendMode {
  return supportedBlendModes.has(value);
}

export function buildLayerSidecarPreviewExportRuntimePlan(
  input: LayerSidecarPreviewExportRuntimeInput,
): LayerSidecarPreviewExportRuntimePlan {
  const sidecar = layerStackSidecarV1Schema.parse(input.sidecar);
  const warnings: Array<LayerSidecarPreviewExportRuntimeWarning> = [];
  const skippedLayerIds: Array<string> = [];
  const layers: Array<LayerBlendStackLayer> = [];

  for (const layer of sidecar.layers) {
    if (!isSidecarLayerOutputBlendMode(layer.blendMode)) {
      skippedLayerIds.push(layer.id);
      warnings.push({
        code: 'unsupported_blend_mode',
        layerId: layer.id,
        message: `Layer ${layer.id} uses unsupported sidecar output blend mode "${layer.blendMode}".`,
      });
      continue;
    }

    const pixels = getLayerPayload(input.layerPixelsById, layer.id);
    if (pixels === undefined) {
      skippedLayerIds.push(layer.id);
      warnings.push({
        code: 'missing_layer_pixels',
        layerId: layer.id,
        message: `Layer ${layer.id} has no sidecar output pixel payload.`,
      });
      continue;
    }

    const renderLayer: LayerBlendStackLayer = {
      blendMode: layer.blendMode,
      id: layer.id,
      name: layer.name,
      opacity: layer.opacity,
      visible: layer.visible,
    };
    const maskAlpha = getLayerPayload(input.layerMaskAlphaById, layer.id);
    if (maskAlpha !== undefined) renderLayer.maskAlpha = maskAlpha;
    renderLayer.pixels = pixels;
    layers.push(renderLayer);
  }

  return {
    graphRevision: sidecar.graphRevision,
    input: {
      basePixels: input.basePixels,
      height: input.height,
      layers,
      width: input.width,
    },
    skippedLayerIds,
    sourceImagePath: sidecar.sourceImagePath,
    warnings,
  };
}

export function renderLayerSidecarPreviewStack(
  input: LayerSidecarPreviewExportRuntimeInput,
): LayerSidecarPreviewExportRuntimeRender {
  return renderLayerSidecarStack(input, renderLayerPreviewStack);
}

export function renderLayerSidecarExportStack(
  input: LayerSidecarPreviewExportRuntimeInput,
): LayerSidecarPreviewExportRuntimeRender {
  return renderLayerSidecarStack(input, renderLayerExportStack);
}

function renderLayerSidecarStack(
  input: LayerSidecarPreviewExportRuntimeInput,
  renderStack: (input: LayerBlendStackInput) => LayerBlendStackRender,
): LayerSidecarPreviewExportRuntimeRender {
  const plan = buildLayerSidecarPreviewExportRuntimePlan(input);
  const render =
    plan.input.layers.length === 0
      ? { coverageByLayer: [], pixels: [...input.basePixels], resolvedRemoveSources: [] }
      : renderStack(plan.input);

  return {
    ...render,
    graphRevision: plan.graphRevision,
    skippedLayerIds: plan.skippedLayerIds,
    sourceImagePath: plan.sourceImagePath,
    warnings: plan.warnings,
  };
}

function getLayerPayload<T>(
  payloadById: Readonly<Record<string, ReadonlyArray<T>>> | undefined,
  layerId: string,
): ReadonlyArray<T> | undefined {
  if (payloadById === undefined) return undefined;
  return payloadById[layerId];
}
