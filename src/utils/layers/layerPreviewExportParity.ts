import {
  removeSourcePointToNormalized,
  resolveRemoveSamplingPlan,
} from '../../../packages/rawengine-schema/src/retouchRemoveRuntime';

export type LayerBlendMode = 'multiply' | 'normal' | 'overlay' | 'screen' | 'soft_light';

export interface LayerRgbPixel {
  b: number;
  g: number;
  r: number;
}

export interface LayerBlendStackLayer {
  blendMode: LayerBlendMode;
  id: string;
  maskAlpha?: ReadonlyArray<number>;
  name: string;
  opacity: number;
  pixels?: ReadonlyArray<LayerRgbPixel>;
  retouchCloneSource?: LayerRetouchCloneSource;
  retouchRemoveSource?: LayerRetouchRemoveSource;
  visible: boolean;
}

export interface LayerRetouchCloneSource {
  alignmentErrorPx?: number;
  candidateProvenance?: {
    candidateId: string;
    candidateKind: 'dust_spot' | 'emulsion_scratch';
    confidence: number;
    confidenceSemantics: 'ranking_score_v1';
    origin: 'negative_lab_dust_candidate';
    sourceFrameId: string;
    statusAtAcceptance: 'acknowledged' | 'ignored' | 'pending';
  };
  featherRadiusPx?: number;
  radiusPx?: number;
  retouchMode?: 'clone' | 'heal';
  rotationDegrees: number;
  scale: number;
  sourcePoint: { x: number; y: number };
  targetPoint: { x: number; y: number };
}

export interface LayerRetouchRemoveSource {
  featherRadiusPx?: number;
  generator: 'local_patch_fill_v1';
  generatorVersion: 1;
  radiusPx?: number;
  resolvedSourcePoint?: { x: number; y: number };
  searchRadiusMultiplier: number;
  seed: number;
  status?: 'fallback_unchanged' | 'needs_regeneration' | 'ready' | 'stale';
  targetMaskId: string;
}

export interface LayerBlendStackInput {
  basePixels: ReadonlyArray<LayerRgbPixel>;
  height: number;
  layers: ReadonlyArray<LayerBlendStackLayer>;
  width: number;
}

export interface LayerBlendStackRender {
  coverageByLayer: Array<{ id: string; opacity: number; touchedPixels: number }>;
  pixels: Array<LayerRgbPixel>;
  resolvedRemoveSources: Array<{
    layerId: string;
    outputSampleHash?: string;
    resolvedSourcePoint?: { x: number; y: number };
    sourceSampleHash?: string;
    status: 'fallback_unchanged' | 'ready';
    targetMaskId: string;
  }>;
}

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const clampByte = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
};

const hashRemoveSample = (label: 'output' | 'source', index: number, pixel: LayerRgbPixel): string => {
  let hash = 0x811c9dc5;
  for (const value of [label === 'source' ? 1 : 2, index, pixel.r, pixel.g, pixel.b]) {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= (value >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
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
  cloneSource: LayerRetouchCloneSource,
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
  pixels: Array<LayerRgbPixel>,
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
  if (!topLeft || !topRight || !bottomLeft || !bottomRight) return undefined;

  const mixChannel = (channel: keyof LayerRgbPixel): number =>
    clampByte(
      topLeft[channel] * (1 - tx) * (1 - ty) +
        topRight[channel] * tx * (1 - ty) +
        bottomLeft[channel] * (1 - tx) * ty +
        bottomRight[channel] * tx * ty,
    );

  return {
    b: mixChannel('b'),
    g: mixChannel('g'),
    r: mixChannel('r'),
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
  retouchSource: LayerRetouchCloneSource,
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
  const pixelCount = input.width * input.height;
  if (input.basePixels.length !== pixelCount) {
    throw new Error(`Layer blend base pixel count mismatch: ${input.basePixels.length} != ${pixelCount}.`);
  }

  const pixels = input.basePixels.map((pixel) => ({
    b: clampByte(pixel.b),
    g: clampByte(pixel.g),
    r: clampByte(pixel.r),
  }));
  const coverageByLayer: LayerBlendStackRender['coverageByLayer'] = [];
  const resolvedRemoveSources: LayerBlendStackRender['resolvedRemoveSources'] = [];

  for (const layer of input.layers) {
    const opacity = clamp01(layer.opacity);
    if (!layer.visible || opacity === 0) continue;
    const isRetouchLayer = layer.retouchCloneSource !== undefined || layer.retouchRemoveSource !== undefined;
    if (!isRetouchLayer && layer.pixels?.length !== pixelCount) {
      throw new Error(`Layer ${layer.id} pixel count mismatch: ${layer.pixels?.length ?? 0} != ${pixelCount}.`);
    }
    if (isRetouchLayer && layer.pixels !== undefined && layer.pixels.length !== pixelCount) {
      throw new Error(`Layer ${layer.id} pixel count mismatch: ${layer.pixels.length} != ${pixelCount}.`);
    }
    if (layer.maskAlpha !== undefined && layer.maskAlpha.length !== pixelCount) {
      throw new Error(`Layer ${layer.id} mask alpha count mismatch: ${layer.maskAlpha.length} != ${pixelCount}.`);
    }

    let touchedPixels = 0;
    const retouchBasePixels = isRetouchLayer ? pixels.map((pixel) => ({ ...pixel })) : null;
    const removePlan =
      layer.retouchRemoveSource === undefined
        ? null
        : resolveRemoveSamplingPlan({
            height: input.height,
            maskAlpha: layer.maskAlpha,
            pixels: retouchBasePixels ?? pixels,
            removeSource: layer.retouchRemoveSource,
            width: input.width,
          });
    const targetAnchorPoint =
      layer.retouchCloneSource === undefined
        ? removePlan === null
          ? null
          : roundPixelPoint(removePlan.targetPoint)
        : normalizedPointToPixel(layer.retouchCloneSource.targetPoint, input.width, input.height);
    const targetAnchorIndex =
      targetAnchorPoint === null ? null : targetAnchorPoint.y * input.width + targetAnchorPoint.x;
    let sourceAnchorIndex: number | null = null;
    if (targetAnchorIndex !== null && retouchBasePixels !== null) {
      if (removePlan !== null) {
        sourceAnchorIndex = translatedSampleIndex(
          targetAnchorIndex,
          input.width,
          input.height,
          removePlan.sourcePoint,
          removePlan.targetPoint,
        );
      } else if (layer.retouchCloneSource !== undefined) {
        const sourceAnchorPoint = cloneSamplePoint(
          targetAnchorIndex,
          input.width,
          input.height,
          layer.retouchCloneSource,
        );
        sourceAnchorIndex =
          sourceAnchorPoint === null ? null : pixelIndexFromPoint(sourceAnchorPoint, input.width, input.height);
      }
    }

    for (let index = 0; index < pixelCount; index += 1) {
      const cloneSourcePoint =
        layer.retouchCloneSource === undefined
          ? null
          : cloneSamplePoint(index, input.width, input.height, layer.retouchCloneSource);
      if (layer.retouchCloneSource !== undefined && cloneSourcePoint === null) continue;
      const removeSourceIndex =
        removePlan === null
          ? null
          : translatedSampleIndex(index, input.width, input.height, removePlan.sourcePoint, removePlan.targetPoint);
      if (layer.retouchRemoveSource !== undefined && removeSourceIndex === null) continue;
      const sampledSource =
        removeSourceIndex !== null
          ? (retouchBasePixels ?? pixels)[removeSourceIndex]
          : cloneSourcePoint === null
            ? layer.pixels?.[index]
            : sampleBilinearPixel(retouchBasePixels ?? pixels, input.width, input.height, cloneSourcePoint);
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
      if (!source || !base) {
        throw new Error(`Layer ${layer.id} missing pixel ${index}.`);
      }

      const retouchAlpha =
        layer.retouchCloneSource !== undefined
          ? retouchTargetAlpha(index, input.width, input.height, layer.retouchCloneSource)
          : removePlan === null || layer.retouchRemoveSource === undefined
            ? 1
            : radialRetouchAlpha(
                index,
                input.width,
                removePlan.targetPoint,
                layer.retouchRemoveSource.radiusPx,
                layer.retouchRemoveSource.featherRadiusPx,
              );
      const alpha = opacity * clamp01(layer.maskAlpha?.[index] ?? 1) * retouchAlpha;
      if (alpha === 0) continue;
      pixels[index] = blendPixel(base, source, layer.blendMode, alpha);
      touchedPixels += 1;
    }

    if (layer.retouchRemoveSource !== undefined) {
      const sourceSample =
        removePlan === null || sourceAnchorIndex === null || retouchBasePixels === null
          ? undefined
          : retouchBasePixels[sourceAnchorIndex];
      const outputSample = removePlan === null || targetAnchorIndex === null ? undefined : pixels[targetAnchorIndex];
      resolvedRemoveSources.push({
        layerId: layer.id,
        ...(removePlan === null
          ? {}
          : { resolvedSourcePoint: removeSourcePointToNormalized(removePlan, input.width, input.height) }),
        ...(removePlan !== null && sourceAnchorIndex !== null && sourceSample !== undefined
          ? { sourceSampleHash: hashRemoveSample('source', sourceAnchorIndex, sourceSample) }
          : {}),
        ...(removePlan !== null && targetAnchorIndex !== null && outputSample !== undefined
          ? { outputSampleHash: hashRemoveSample('output', targetAnchorIndex, outputSample) }
          : {}),
        status: removePlan === null ? 'fallback_unchanged' : 'ready',
        targetMaskId: layer.retouchRemoveSource.targetMaskId,
      });
    }

    coverageByLayer.push({ id: layer.id, opacity, touchedPixels });
  }

  return { coverageByLayer, pixels, resolvedRemoveSources };
}

export const renderLayerPreviewStack = renderLayerBlendStack;
export const renderLayerExportStack = renderLayerBlendStack;
export const renderLayerHeadlessStack = renderLayerBlendStack;
