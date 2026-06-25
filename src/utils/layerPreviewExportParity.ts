import {
  removeSourcePointToNormalized,
  resolveRemoveSamplingPlan,
} from '../../packages/rawengine-schema/src/retouchRemoveRuntime';

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
    resolvedSourcePoint?: { x: number; y: number };
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

const cloneSampleIndex = (
  targetIndex: number,
  width: number,
  height: number,
  cloneSource: LayerRetouchCloneSource,
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
    if (layer.retouchRemoveSource !== undefined) {
      resolvedRemoveSources.push({
        layerId: layer.id,
        ...(removePlan === null
          ? {}
          : { resolvedSourcePoint: removeSourcePointToNormalized(removePlan, input.width, input.height) }),
        status: removePlan === null ? 'fallback_unchanged' : 'ready',
        targetMaskId: layer.retouchRemoveSource.targetMaskId,
      });
    }
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
        sourceAnchorIndex = cloneSampleIndex(targetAnchorIndex, input.width, input.height, layer.retouchCloneSource);
      }
    }

    for (let index = 0; index < pixelCount; index += 1) {
      const cloneSourceIndex =
        layer.retouchCloneSource === undefined
          ? null
          : cloneSampleIndex(index, input.width, input.height, layer.retouchCloneSource);
      if (layer.retouchCloneSource !== undefined && cloneSourceIndex === null) continue;
      const removeSourceIndex =
        removePlan === null
          ? null
          : translatedSampleIndex(index, input.width, input.height, removePlan.sourcePoint, removePlan.targetPoint);
      if (layer.retouchRemoveSource !== undefined && removeSourceIndex === null) continue;
      const sampledSource =
        removeSourceIndex !== null
          ? (retouchBasePixels ?? pixels)[removeSourceIndex]
          : cloneSourceIndex === null
            ? layer.pixels?.[index]
            : (retouchBasePixels ?? pixels)[cloneSourceIndex];
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

    coverageByLayer.push({ id: layer.id, opacity, touchedPixels });
  }

  return { coverageByLayer, pixels, resolvedRemoveSources };
}

export const renderLayerPreviewStack = renderLayerBlendStack;
export const renderLayerExportStack = renderLayerBlendStack;
export const renderLayerHeadlessStack = renderLayerBlendStack;
