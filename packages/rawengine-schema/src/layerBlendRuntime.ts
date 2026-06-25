import { z } from 'zod';

import {
  layerMaskBlendModeV1Schema,
  layerMaskCloneSourceV1Schema,
  layerMaskRemoveSourceV1Schema,
} from './rawEngineSchemas.js';
import { resolveRemoveSamplingPlan } from './retouchRemoveRuntime.js';

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
    retouchRemoveSource: layerMaskRemoveSourceV1Schema.optional(),
    visible: z.boolean(),
  })
  .strict()
  .superRefine((layer, context) => {
    if (layer.retouchCloneSource !== undefined && layer.retouchRemoveSource !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Layer cannot have both clone/heal and remove retouch sources.',
        path: ['retouchRemoveSource'],
      });
    }
  });

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
      const isRetouchLayer = layer.retouchCloneSource !== undefined || layer.retouchRemoveSource !== undefined;
      if (!isRetouchLayer && layer.pixels?.length !== pixelCount) {
        context.addIssue({ code: 'custom', message: 'layer pixels must match dimensions.', path: ['layers', index] });
      }
      if (isRetouchLayer && layer.pixels !== undefined && layer.pixels.length !== pixelCount) {
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

const roundPixelPoint = (point: { x: number; y: number }): { x: number; y: number } => ({
  x: Math.round(point.x),
  y: Math.round(point.y),
});

const cloneSamplePoint = (
  targetIndex: number,
  width: number,
  height: number,
  cloneSource: NonNullable<LayerBlendStackLayer['retouchCloneSource']>,
): { x: number; y: number } | null => {
  const sourcePoint = normalizedPointToPixel(cloneSource.sourcePoint, width, height);
  const targetPoint = normalizedPointToPixel(cloneSource.targetPoint, width, height);
  const targetX = targetIndex % width;
  const targetY = Math.floor(targetIndex / width);
  const scale = Math.max(0.1, cloneSource.scale);
  const radians = (-cloneSource.rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const targetOffsetX = (targetX - targetPoint.x) / scale;
  const targetOffsetY = (targetY - targetPoint.y) / scale;
  const sourceX = sourcePoint.x + targetOffsetX * cos - targetOffsetY * sin;
  const sourceY = sourcePoint.y + targetOffsetX * sin + targetOffsetY * cos;
  if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) return null;
  return { x: sourceX, y: sourceY };
};

const pixelIndexFromPoint = (point: { x: number; y: number }, width: number, height: number): number | null => {
  const sourceX = Math.round(point.x);
  const sourceY = Math.round(point.y);
  if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) return null;
  return sourceY * width + sourceX;
};

const sampleBilinearPixel = (
  pixels: LayerRgbPixel[],
  width: number,
  height: number,
  point: { x: number; y: number },
): LayerRgbPixel | undefined => {
  if (point.x < 0 || point.x > width - 1 || point.y < 0 || point.y > height - 1) return undefined;

  const x0 = Math.floor(point.x);
  const y0 = Math.floor(point.y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = point.x - x0;
  const ty = point.y - y0;
  const topLeft = pixels[y0 * width + x0];
  const topRight = pixels[y0 * width + x1];
  const bottomLeft = pixels[y1 * width + x0];
  const bottomRight = pixels[y1 * width + x1];
  if (topLeft === undefined || topRight === undefined || bottomLeft === undefined || bottomRight === undefined) {
    return undefined;
  }

  const channel = (key: keyof LayerRgbPixel) =>
    topLeft[key] * (1 - tx) * (1 - ty) +
    topRight[key] * tx * (1 - ty) +
    bottomLeft[key] * (1 - tx) * ty +
    bottomRight[key] * tx * ty;

  return {
    b: clampByte(channel('b')),
    g: clampByte(channel('g')),
    r: clampByte(channel('r')),
  };
};

const translatedSampleIndex = (
  targetIndex: number,
  width: number,
  height: number,
  sourcePoint: { x: number; y: number },
  targetPoint: { x: number; y: number },
): number | null => {
  const targetX = targetIndex % width;
  const targetY = Math.floor(targetIndex / width);
  const sourceX = Math.round(targetX + sourcePoint.x - targetPoint.x);
  const sourceY = Math.round(targetY + sourcePoint.y - targetPoint.y);
  if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) return null;
  return sourceY * width + sourceX;
};

const radialRetouchAlpha = (
  targetIndex: number,
  width: number,
  targetPoint: { x: number; y: number },
  radiusPxInput: number | undefined,
  featherRadiusPxInput: number | undefined,
): number => {
  if (radiusPxInput === undefined) return 1;

  const radiusPx = Math.max(0, radiusPxInput);
  if (radiusPx === 0) return 0;

  const targetX = targetIndex % width;
  const targetY = Math.floor(targetIndex / width);
  const distance = Math.hypot(targetX - targetPoint.x, targetY - targetPoint.y);
  const featherPx = Math.min(Math.max(0, featherRadiusPxInput ?? 0), radiusPx);
  const solidRadius = radiusPx - featherPx;

  if (distance <= solidRadius) return 1;
  if (distance >= radiusPx) return 0;
  return clamp01((radiusPx - distance) / Math.max(featherPx, 1));
};

const retouchTargetAlpha = (
  targetIndex: number,
  width: number,
  height: number,
  retouchSource: NonNullable<LayerBlendStackLayer['retouchCloneSource']>,
): number =>
  radialRetouchAlpha(
    targetIndex,
    width,
    normalizedPointToPixel(retouchSource.targetPoint, width, height),
    retouchSource.radiusPx,
    retouchSource.featherRadiusPx,
  );

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
    const isRetouchLayer = layer.retouchCloneSource !== undefined || layer.retouchRemoveSource !== undefined;
    const retouchBasePixels = isRetouchLayer ? pixels.map((pixel) => ({ ...pixel })) : null;
    const removePlan =
      layer.retouchRemoveSource === undefined
        ? null
        : resolveRemoveSamplingPlan({
            height: parsedInput.height,
            maskAlpha: layer.maskAlpha,
            pixels: retouchBasePixels ?? pixels,
            removeSource: layer.retouchRemoveSource,
            width: parsedInput.width,
          });
    const targetAnchorPoint =
      layer.retouchCloneSource === undefined
        ? removePlan === null
          ? null
          : roundPixelPoint(removePlan.targetPoint)
        : normalizedPointToPixel(layer.retouchCloneSource.targetPoint, parsedInput.width, parsedInput.height);
    const targetAnchorIndex =
      targetAnchorPoint === null ? null : targetAnchorPoint.y * parsedInput.width + targetAnchorPoint.x;
    let sourceAnchorIndex: number | null = null;
    if (targetAnchorIndex !== null && retouchBasePixels !== null) {
      if (removePlan !== null) {
        sourceAnchorIndex = translatedSampleIndex(
          targetAnchorIndex,
          parsedInput.width,
          parsedInput.height,
          removePlan.sourcePoint,
          removePlan.targetPoint,
        );
      } else if (layer.retouchCloneSource !== undefined) {
        const sourceAnchorPoint = cloneSamplePoint(
          targetAnchorIndex,
          parsedInput.width,
          parsedInput.height,
          layer.retouchCloneSource,
        );
        sourceAnchorIndex =
          sourceAnchorPoint === null
            ? null
            : pixelIndexFromPoint(sourceAnchorPoint, parsedInput.width, parsedInput.height);
      }
    }

    for (let index = 0; index < pixelCount; index += 1) {
      const cloneSourcePoint =
        layer.retouchCloneSource === undefined
          ? null
          : cloneSamplePoint(index, parsedInput.width, parsedInput.height, layer.retouchCloneSource);
      if (layer.retouchCloneSource !== undefined && cloneSourcePoint === null) continue;
      const removeSourceIndex =
        removePlan === null
          ? null
          : translatedSampleIndex(
              index,
              parsedInput.width,
              parsedInput.height,
              removePlan.sourcePoint,
              removePlan.targetPoint,
            );
      if (layer.retouchRemoveSource !== undefined && removeSourceIndex === null) continue;
      const sampledSource =
        removeSourceIndex !== null
          ? (retouchBasePixels ?? pixels)[removeSourceIndex]
          : cloneSourcePoint === null
            ? layer.pixels?.[index]
            : sampleBilinearPixel(retouchBasePixels ?? pixels, parsedInput.width, parsedInput.height, cloneSourcePoint);
      const source =
        (layer.retouchCloneSource?.retouchMode === 'heal' || layer.retouchRemoveSource !== undefined) &&
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
        layer.retouchCloneSource !== undefined
          ? retouchTargetAlpha(index, parsedInput.width, parsedInput.height, layer.retouchCloneSource)
          : removePlan === null || layer.retouchRemoveSource === undefined
            ? 1
            : radialRetouchAlpha(
                index,
                parsedInput.width,
                removePlan.targetPoint,
                layer.retouchRemoveSource.radiusPx,
                layer.retouchRemoveSource.featherRadiusPx,
              );
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
