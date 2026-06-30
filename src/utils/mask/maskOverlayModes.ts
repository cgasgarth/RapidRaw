import { type MaskOverlaySettings, maskOverlaySettingsSchema } from '../../schemas/masks/maskOverlaySchemas';

export interface MaskOverlayColor {
  a: number;
  b: number;
  g: number;
  r: number;
}

const clamp01 = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

export function normalizeMaskOverlaySettings(settings: Partial<MaskOverlaySettings> = {}): MaskOverlaySettings {
  return maskOverlaySettingsSchema.parse({
    edgeThreshold: clamp01(settings.edgeThreshold ?? 0.5),
    mode: settings.mode ?? 'rubylith',
    opacity: clamp01(settings.opacity ?? 0.5),
  });
}

export function evaluateMaskOverlayColor(maskWeight: number, settings: MaskOverlaySettings): MaskOverlayColor {
  const parsed = maskOverlaySettingsSchema.parse(settings);
  const weight = clamp01(maskWeight);
  const alpha = parsed.mode === 'hidden' ? 0 : parsed.opacity * weight;

  if (parsed.mode === 'hidden') return { a: 0, b: 0, g: 0, r: 0 };
  if (parsed.mode === 'rubylith') return { a: alpha, b: 48, g: 24, r: 255 };
  if (parsed.mode === 'green') return { a: alpha, b: 72, g: 224, r: 32 };
  if (parsed.mode === 'blue') return { a: alpha, b: 255, g: 112, r: 32 };
  if (parsed.mode === 'white') return { a: alpha, b: 255, g: 255, r: 255 };
  if (parsed.mode === 'black') return { a: alpha, b: 0, g: 0, r: 0 };
  if (parsed.mode === 'inverse')
    return { a: parsed.opacity, b: 255 * (1 - weight), g: 255 * (1 - weight), r: 255 * (1 - weight) };
  if (parsed.mode === 'edges') {
    const edgeWeight = Math.abs(weight - parsed.edgeThreshold) <= 0.05 ? 1 : 0;
    return { a: parsed.opacity * edgeWeight, b: 255, g: 255, r: 255 };
  }

  const channel = Math.round(255 * weight);
  return { a: parsed.opacity, b: channel, g: channel, r: channel };
}
