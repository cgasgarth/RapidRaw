import { z } from 'zod';

import {
  type LayerBlendMode,
  type LayerRgbPixel,
  layerBlendStackLayerSchema,
  layerBlendStackRenderSchema,
  layerRgbPixelSchema,
  renderLayerExportStack,
  renderLayerHeadlessStack,
  renderLayerPreviewStack,
} from './layerBlendRuntime.js';
import type { LayerScopedToneAdjustmentV1 } from './layerScopedToneSchemas.js';
import { layerStackSidecarV1Schema } from './layerStackCommandRuntime.js';

const renderableBlendModeSchema = z.enum([
  'hue',
  'multiply',
  'normal',
  'overlay',
  'saturation',
  'screen',
  'soft_light',
]);

export const layerScopedToneRenderInputV1Schema = z
  .object({
    basePixels: z.array(layerRgbPixelSchema).min(1),
    height: z.number().int().positive().max(16384),
    sidecar: layerStackSidecarV1Schema,
    width: z.number().int().positive().max(16384),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.basePixels.length !== input.width * input.height) {
      context.addIssue({ code: 'custom', message: 'basePixels must match dimensions.', path: ['basePixels'] });
    }
  });

export const layerScopedToneRenderResultV1Schema = z
  .object({
    changedPixelCount: z.number().int().nonnegative(),
    exportHash: z.string().trim().min(1),
    exportRender: layerBlendStackRenderSchema,
    headlessHash: z.string().trim().min(1),
    headlessRender: layerBlendStackRenderSchema,
    previewHash: z.string().trim().min(1),
    previewRender: layerBlendStackRenderSchema,
    renderedLayerIds: z.array(z.string().trim().min(1)),
    sidecarRoundtrip: layerStackSidecarV1Schema,
    sourceHash: z.string().trim().min(1),
  })
  .strict();

export type LayerScopedToneRenderInputV1 = z.infer<typeof layerScopedToneRenderInputV1Schema>;
export type LayerScopedToneRenderResultV1 = z.infer<typeof layerScopedToneRenderResultV1Schema>;

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const clampByte = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
};

const hashPixels = (pixels: ReadonlyArray<LayerRgbPixel>): string => {
  let hash = 0x811c9dc5;
  for (const pixel of pixels) {
    hash ^= clampByte(pixel.r);
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= clampByte(pixel.g);
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= clampByte(pixel.b);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
};

const applyToneAdjustment = (pixel: LayerRgbPixel, adjustment: LayerScopedToneAdjustmentV1): LayerRgbPixel => {
  const exposureScale = 2 ** adjustment.exposureEv;
  const contrastScale = 1 + adjustment.contrast / 100;
  const saturationScale = 1 + adjustment.saturation / 100;
  const lift = (adjustment.shadows + adjustment.blackPoint) / 300;
  const shoulder = (adjustment.highlights + adjustment.whitePoint) / 300;
  const clarity = adjustment.clarity / 500;

  const toUnit = (channel: number) => clamp01(channel / 255);
  const r = toUnit(pixel.r);
  const g = toUnit(pixel.g);
  const b = toUnit(pixel.b);
  const mean = (r + g + b) / 3;

  const toneChannel = (channel: number): number => {
    const lifted = channel * exposureScale + lift + shoulder * channel + clarity * (channel - mean);
    const contrasted = (lifted - 0.5) * contrastScale + 0.5;
    const saturated = mean + (contrasted - mean) * saturationScale;
    return clampByte(clamp01(saturated) * 255);
  };

  return {
    b: toneChannel(b),
    g: toneChannel(g),
    r: toneChannel(r),
  };
};

export const renderLayerScopedToneStack = (value: unknown): LayerScopedToneRenderResultV1 => {
  const input = layerScopedToneRenderInputV1Schema.parse(value);
  const sourceHash = hashPixels(input.basePixels);

  const layers = input.sidecar.layers.flatMap((layer) => {
    const adjustment = layer.adjustments?.toneColor;
    if (adjustment === undefined) return [];
    const blendMode: LayerBlendMode = renderableBlendModeSchema.parse(layer.blendMode);
    return layerBlendStackLayerSchema.parse({
      blendMode,
      id: layer.id,
      name: layer.name,
      opacity: layer.opacity,
      pixels: input.basePixels.map((pixel) => applyToneAdjustment(pixel, adjustment)),
      visible: layer.visible,
    });
  });

  const stackInput = {
    basePixels: input.basePixels,
    height: input.height,
    layers,
    width: input.width,
  };
  const previewRender = renderLayerPreviewStack(stackInput);
  const exportRender = renderLayerExportStack(stackInput);
  const headlessRender = renderLayerHeadlessStack(stackInput);
  const previewHash = hashPixels(previewRender.pixels);
  const exportHash = hashPixels(exportRender.pixels);
  const headlessHash = hashPixels(headlessRender.pixels);
  const changedPixelCount = previewRender.pixels.filter((pixel, index) => {
    const source = input.basePixels[index];
    return source !== undefined && (pixel.r !== source.r || pixel.g !== source.g || pixel.b !== source.b);
  }).length;

  return layerScopedToneRenderResultV1Schema.parse({
    changedPixelCount,
    exportHash,
    exportRender,
    headlessHash,
    headlessRender,
    previewHash,
    previewRender,
    renderedLayerIds: layers.map((layer) => layer.id),
    sidecarRoundtrip: structuredClone(input.sidecar),
    sourceHash,
  });
};
