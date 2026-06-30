import type { MaskAdjustments, MaskContainer } from '../adjustments';
import { findLayerIndex } from './layerStack';

export const LAYER_ADJUSTMENT_KEYS = [
  'blacks',
  'brightness',
  'clarity',
  'colorNoiseReduction',
  'contrast',
  'dehaze',
  'exposure',
  'flareAmount',
  'glowAmount',
  'halationAmount',
  'highlights',
  'lumaNoiseReduction',
  'saturation',
  'shadows',
  'sharpness',
  'sharpnessThreshold',
  'structure',
  'temperature',
  'tint',
  'vibrance',
  'whites',
] as const;

export type LayerAdjustmentKey = (typeof LAYER_ADJUSTMENT_KEYS)[number];
export type LayerAdjustmentPatch = Partial<Record<LayerAdjustmentKey, number>>;

interface LayerAdjustmentLimit {
  max: number;
  min: number;
}

export const LAYER_ADJUSTMENT_LIMITS: Record<LayerAdjustmentKey, LayerAdjustmentLimit> = {
  blacks: { min: -100, max: 100 },
  brightness: { min: -100, max: 100 },
  clarity: { min: -100, max: 100 },
  colorNoiseReduction: { min: -100, max: 100 },
  contrast: { min: -100, max: 100 },
  dehaze: { min: -100, max: 100 },
  exposure: { min: -5, max: 5 },
  flareAmount: { min: 0, max: 100 },
  glowAmount: { min: 0, max: 100 },
  halationAmount: { min: 0, max: 100 },
  highlights: { min: -100, max: 100 },
  lumaNoiseReduction: { min: -100, max: 100 },
  saturation: { min: -100, max: 100 },
  shadows: { min: -100, max: 100 },
  sharpness: { min: -100, max: 100 },
  sharpnessThreshold: { min: 0, max: 100 },
  structure: { min: -100, max: 100 },
  temperature: { min: -100, max: 100 },
  tint: { min: -100, max: 100 },
  vibrance: { min: -100, max: 100 },
  whites: { min: -100, max: 100 },
};

export function clampLayerAdjustmentValue(key: LayerAdjustmentKey, value: number): number {
  const limits = LAYER_ADJUSTMENT_LIMITS[key];
  if (!Number.isFinite(value)) return 0;
  return Math.max(limits.min, Math.min(limits.max, value));
}

export function setLayerAdjustment(
  layers: Array<MaskContainer>,
  layerId: string,
  key: LayerAdjustmentKey,
  value: number,
): Array<MaskContainer> {
  findLayerIndex(layers, layerId);
  const clampedValue = clampLayerAdjustmentValue(key, value);

  return layers.map((layer) =>
    layer.id === layerId
      ? {
          ...layer,
          adjustments: {
            ...layer.adjustments,
            [key]: clampedValue,
          },
        }
      : layer,
  );
}

export function setLayerAdjustments(
  layers: Array<MaskContainer>,
  layerId: string,
  patch: LayerAdjustmentPatch,
): Array<MaskContainer> {
  findLayerIndex(layers, layerId);
  return layers.map((layer) => {
    if (layer.id !== layerId) return layer;

    const adjustments: MaskAdjustments = { ...layer.adjustments };
    for (const key of LAYER_ADJUSTMENT_KEYS) {
      const value = patch[key];
      if (value !== undefined) {
        adjustments[key] = clampLayerAdjustmentValue(key, value);
      }
    }

    return { ...layer, adjustments };
  });
}

export function getLayerAdjustmentSnapshot(
  layers: Array<MaskContainer>,
  layerId: string,
  keys: ReadonlyArray<LayerAdjustmentKey> = LAYER_ADJUSTMENT_KEYS,
): Record<LayerAdjustmentKey, number> {
  const layer = layers[findLayerIndex(layers, layerId)];
  if (!layer) {
    throw new Error(`Layer ${layerId} does not exist.`);
  }

  const snapshot = {} as Record<LayerAdjustmentKey, number>;
  for (const key of keys) {
    snapshot[key] = layer.adjustments[key];
  }
  return snapshot;
}
