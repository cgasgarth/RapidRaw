import { z } from 'zod';

import { layerMaskBlendModeV1Schema, layerMaskCloneSourceV1Schema } from './rawEngineSchemas.js';

export const layerRgbPixelSchema = z
  .object({
    b: z.number().int().min(0).max(255),
    g: z.number().int().min(0).max(255),
    r: z.number().int().min(0).max(255),
  })
  .strict();

export const layerBlendStackLayerSchema = z
  .object({
    blendMode: layerMaskBlendModeV1Schema.extract(['multiply', 'normal', 'overlay', 'screen', 'soft_light']),
    id: z.string().trim().min(1),
    maskAlpha: z.array(z.number().min(0).max(1)).optional(),
    name: z.string().trim().min(1),
    opacity: z.number().min(0).max(1),
    pixels: z.array(layerRgbPixelSchema).min(1).optional(),
    retouchCloneSource: layerMaskCloneSourceV1Schema.optional(),
    visible: z.boolean(),
  })
  .strict();

export const layerBlendStackInputSchema = z
  .object({
    basePixels: z.array(layerRgbPixelSchema).min(1),
    height: z.number().int().positive().max(16384),
    layers: z.array(layerBlendStackLayerSchema).min(1),
    width: z.number().int().positive().max(16384),
  })
  .strict()
  .superRefine((input, context) => {
    const pixelCount = input.width * input.height;
    if (input.basePixels.length !== pixelCount) {
      context.addIssue({ code: 'custom', message: 'basePixels must match dimensions.', path: ['basePixels'] });
    }

    for (const [index, layer] of input.layers.entries()) {
      if (layer.retouchCloneSource === undefined && layer.pixels?.length !== pixelCount) {
        context.addIssue({ code: 'custom', message: 'layer pixels must match dimensions.', path: ['layers', index] });
      }
      if (layer.retouchCloneSource !== undefined && layer.pixels !== undefined && layer.pixels.length !== pixelCount) {
        context.addIssue({ code: 'custom', message: 'layer pixels must match dimensions.', path: ['layers', index] });
      }
      if (layer.maskAlpha !== undefined && layer.maskAlpha.length !== pixelCount) {
        context.addIssue({ code: 'custom', message: 'maskAlpha must match dimensions.', path: ['layers', index] });
      }
    }
  });

export const layerBlendCoverageSchema = z
  .object({
    id: z.string().trim().min(1),
    opacity: z.number().min(0).max(1),
    touchedPixels: z.number().int().nonnegative(),
  })
  .strict();

export const layerBlendStackRenderSchema = z
  .object({
    coverageByLayer: z.array(layerBlendCoverageSchema),
    pixels: z.array(layerRgbPixelSchema).min(1),
  })
  .strict();

export type LayerRgbPixel = z.infer<typeof layerRgbPixelSchema>;
export type LayerBlendStackLayer = z.infer<typeof layerBlendStackLayerSchema>;
export type LayerBlendStackInput = z.infer<typeof layerBlendStackInputSchema>;
export type LayerBlendStackRender = z.infer<typeof layerBlendStackRenderSchema>;
export type LayerBlendMode = LayerBlendStackLayer['blendMode'];

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const clampByte = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
};

const blendChannel = (base: number, source: number, mode: LayerBlendMode): number => {
  const baseUnit = clampByte(base) / 255;
  const sourceUnit = clampByte(source) / 255;

  if (mode === 'multiply') return baseUnit * sourceUnit * 255;
  if (mode === 'screen') return (1 - (1 - baseUnit) * (1 - sourceUnit)) * 255;
  if (mode === 'overlay') {
    return (baseUnit < 0.5 ? 2 * baseUnit * sourceUnit : 1 - 2 * (1 - baseUnit) * (1 - sourceUnit)) * 255;
  }
  if (mode === 'soft_light') {
    const dodge = baseUnit <= 0.25 ? ((16 * baseUnit - 12) * baseUnit + 4) * baseUnit : Math.sqrt(baseUnit);
    const blended =
      sourceUnit <= 0.5
        ? baseUnit - (1 - 2 * sourceUnit) * baseUnit * (1 - baseUnit)
        : baseUnit + (2 * sourceUnit - 1) * (dodge - baseUnit);
    return blended * 255;
  }

  return source;
};

const blendPixel = (base: LayerRgbPixel, source: LayerRgbPixel, mode: LayerBlendMode, alpha: number): LayerRgbPixel => {
  const blend = (baseChannel: number, sourceChannel: number) =>
    clampByte(baseChannel * (1 - alpha) + blendChannel(baseChannel, sourceChannel, mode) * alpha);

  return {
    b: blend(base.b, source.b),
    g: blend(base.g, source.g),
    r: blend(base.r, source.r),
  };
};

const normalizedPointToPixel = (
  point: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number } => ({
  x: Math.round(clamp01(point.x) * (width - 1)),
  y: Math.round(clamp01(point.y) * (height - 1)),
});

const cloneSampleIndex = (
  targetIndex: number,
  width: number,
  height: number,
  cloneSource: NonNullable<LayerBlendStackLayer['retouchCloneSource']>,
): number | null => {
  if (cloneSource.rotationDegrees !== 0 || cloneSource.scale !== 1) {
    throw new Error('Retouch clone layer rendering supports exact translated sampling only.');
  }

  const sourcePoint = normalizedPointToPixel(cloneSource.sourcePoint, width, height);
  const targetPoint = normalizedPointToPixel(cloneSource.targetPoint, width, height);
  const targetX = targetIndex % width;
  const targetY = Math.floor(targetIndex / width);
  const sourceX = targetX + sourcePoint.x - targetPoint.x;
  const sourceY = targetY + sourcePoint.y - targetPoint.y;
  if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) return null;
  return sourceY * width + sourceX;
};

const retouchTargetAlpha = (
  targetIndex: number,
  width: number,
  height: number,
  retouchSource: NonNullable<LayerBlendStackLayer['retouchCloneSource']>,
): number => {
  if (retouchSource.radiusPx === undefined) return 1;

  const radiusPx = Math.max(0, retouchSource.radiusPx);
  if (radiusPx === 0) return 0;

  const targetPoint = normalizedPointToPixel(retouchSource.targetPoint, width, height);
  const targetX = targetIndex % width;
  const targetY = Math.floor(targetIndex / width);
  const distance = Math.hypot(targetX - targetPoint.x, targetY - targetPoint.y);
  const featherPx = Math.min(Math.max(0, retouchSource.featherRadiusPx ?? 0), radiusPx);
  const solidRadius = radiusPx - featherPx;

  if (distance <= solidRadius) return 1;
  if (distance >= radiusPx) return 0;
  return clamp01((radiusPx - distance) / Math.max(featherPx, 1));
};

const healPixel = (source: LayerRgbPixel, sourceAnchor: LayerRgbPixel, targetAnchor: LayerRgbPixel): LayerRgbPixel => ({
  b: clampByte(source.b + targetAnchor.b - sourceAnchor.b),
  g: clampByte(source.g + targetAnchor.g - sourceAnchor.g),
  r: clampByte(source.r + targetAnchor.r - sourceAnchor.r),
});

export function renderLayerBlendStack(input: LayerBlendStackInput): LayerBlendStackRender {
  const parsedInput = layerBlendStackInputSchema.parse(input);
  const pixelCount = parsedInput.width * parsedInput.height;
  const pixels = parsedInput.basePixels.map((pixel) => ({
    b: clampByte(pixel.b),
    g: clampByte(pixel.g),
    r: clampByte(pixel.r),
  }));
  const coverageByLayer: LayerBlendStackRender['coverageByLayer'] = [];

  for (const layer of parsedInput.layers) {
    const opacity = clamp01(layer.opacity);
    if (!layer.visible || opacity === 0) continue;

    let touchedPixels = 0;
    const retouchBasePixels = layer.retouchCloneSource === undefined ? null : pixels.map((pixel) => ({ ...pixel }));
    const targetAnchorPoint =
      layer.retouchCloneSource === undefined
        ? null
        : normalizedPointToPixel(layer.retouchCloneSource.targetPoint, parsedInput.width, parsedInput.height);
    const targetAnchorIndex =
      targetAnchorPoint === null ? null : targetAnchorPoint.y * parsedInput.width + targetAnchorPoint.x;
    const sourceAnchorIndex =
      layer.retouchCloneSource === undefined || targetAnchorIndex === null
        ? null
        : cloneSampleIndex(targetAnchorIndex, parsedInput.width, parsedInput.height, layer.retouchCloneSource);

    for (let index = 0; index < pixelCount; index += 1) {
      const cloneSourceIndex =
        layer.retouchCloneSource === undefined
          ? null
          : cloneSampleIndex(index, parsedInput.width, parsedInput.height, layer.retouchCloneSource);
      if (layer.retouchCloneSource !== undefined && cloneSourceIndex === null) continue;
      const sampledSource =
        cloneSourceIndex === null ? layer.pixels?.[index] : (retouchBasePixels ?? pixels)[cloneSourceIndex];
      const source =
        layer.retouchCloneSource?.retouchMode === 'heal' &&
        sampledSource !== undefined &&
        retouchBasePixels !== null &&
        sourceAnchorIndex !== null &&
        targetAnchorIndex !== null
          ? healPixel(
              sampledSource,
              retouchBasePixels[sourceAnchorIndex] ?? sampledSource,
              retouchBasePixels[targetAnchorIndex] ?? sampledSource,
            )
          : sampledSource;
      const base = pixels[index];
      if (source === undefined || base === undefined) {
        throw new Error(`Layer ${layer.id} missing pixel ${index}.`);
      }

      const retouchAlpha =
        layer.retouchCloneSource === undefined
          ? 1
          : retouchTargetAlpha(index, parsedInput.width, parsedInput.height, layer.retouchCloneSource);
      const alpha = opacity * clamp01(layer.maskAlpha?.[index] ?? 1) * retouchAlpha;
      if (alpha === 0) continue;
      pixels[index] = blendPixel(base, source, layer.blendMode, alpha);
      touchedPixels += 1;
    }

    coverageByLayer.push({ id: layer.id, opacity, touchedPixels });
  }

  return layerBlendStackRenderSchema.parse({ coverageByLayer, pixels });
}

export const renderLayerPreviewStack = renderLayerBlendStack;
export const renderLayerExportStack = renderLayerBlendStack;
export const renderLayerHeadlessStack = renderLayerBlendStack;
