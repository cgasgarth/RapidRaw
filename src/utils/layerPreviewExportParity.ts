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
  visible: boolean;
}

export interface LayerRetouchCloneSource {
  alignmentErrorPx?: number;
  rotationDegrees: number;
  scale: number;
  sourcePoint: { x: number; y: number };
  targetPoint: { x: number; y: number };
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

  for (const layer of input.layers) {
    const opacity = clamp01(layer.opacity);
    if (!layer.visible || opacity === 0) continue;
    if (layer.retouchCloneSource === undefined && layer.pixels?.length !== pixelCount) {
      throw new Error(`Layer ${layer.id} pixel count mismatch: ${layer.pixels?.length ?? 0} != ${pixelCount}.`);
    }
    if (layer.retouchCloneSource !== undefined && layer.pixels !== undefined && layer.pixels.length !== pixelCount) {
      throw new Error(`Layer ${layer.id} pixel count mismatch: ${layer.pixels.length} != ${pixelCount}.`);
    }
    if (layer.maskAlpha !== undefined && layer.maskAlpha.length !== pixelCount) {
      throw new Error(`Layer ${layer.id} mask alpha count mismatch: ${layer.maskAlpha.length} != ${pixelCount}.`);
    }

    let touchedPixels = 0;
    for (let index = 0; index < pixelCount; index += 1) {
      const cloneSourceIndex =
        layer.retouchCloneSource === undefined
          ? null
          : cloneSampleIndex(index, input.width, input.height, layer.retouchCloneSource);
      if (layer.retouchCloneSource !== undefined && cloneSourceIndex === null) continue;
      const source = cloneSourceIndex === null ? layer.pixels?.[index] : pixels[cloneSourceIndex];
      const base = pixels[index];
      if (!source || !base) {
        throw new Error(`Layer ${layer.id} missing pixel ${index}.`);
      }

      const alpha = opacity * clamp01(layer.maskAlpha?.[index] ?? 1);
      if (alpha === 0) continue;
      pixels[index] = blendPixel(base, source, layer.blendMode, alpha);
      touchedPixels += 1;
    }

    coverageByLayer.push({ id: layer.id, opacity, touchedPixels });
  }

  return { coverageByLayer, pixels };
}

export const renderLayerPreviewStack = renderLayerBlendStack;
export const renderLayerExportStack = renderLayerBlendStack;
export const renderLayerHeadlessStack = renderLayerBlendStack;
