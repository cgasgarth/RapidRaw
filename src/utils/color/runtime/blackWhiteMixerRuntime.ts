import {
  type BlackWhiteMixerChannel,
  type BlackWhiteMixerSettings,
  parseBlackWhiteMixerSettings,
} from '../../../schemas/color/blackWhiteMixerSchemas';
import type { SELECTIVE_COLOR_RANGES } from '../../../utils/selectiveColorRanges';

export interface RgbPixel {
  blue: number;
  green: number;
  red: number;
}

export interface BlackWhiteMixerRuntimeResult {
  influence: Partial<Record<(typeof SELECTIVE_COLOR_RANGES)[number]['key'], number>>;
  luminance: number;
  outputRgb: RgbPixel;
  receipt: MonochromeRuntimeReceiptV1;
  weightedAdjustment: number;
}

export interface MonochromeRuntimeReceiptV1 {
  equalChannelOutput: boolean;
  implementationVersion: 1;
  inputHeadroomPreserved: boolean;
  neutralMix: readonly [number, number, number];
  process: BlackWhiteMixerSettings['process'];
  responseBoundsEv: readonly [number, number];
  sourceClass: BlackWhiteMixerSettings['sourceClass'];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const acesCgLuminance = ({ blue, green, red }: RgbPixel) => 0.27222872 * red + 0.67408174 * green + 0.05368952 * blue;
const CONTINUOUS_ANCHORS: ReadonlyArray<{ hue: number; key: BlackWhiteMixerChannel }> = [
  { hue: 0, key: 'reds' },
  { hue: 25, key: 'oranges' },
  { hue: 60, key: 'yellows' },
  { hue: 115, key: 'greens' },
  { hue: 180, key: 'aquas' },
  { hue: 225, key: 'blues' },
  { hue: 280, key: 'purples' },
  { hue: 330, key: 'magentas' },
];

const sanitizeSceneChannel = (value: number) =>
  Number.isFinite(value) ? Math.min(65_504, Math.max(-65_504, value)) : 0;

const ap1ToOklab = ({ blue, green, red }: RgbPixel): [number, number, number] => {
  const srgb = {
    blue: -0.0240033 * red - 0.1289688 * green + 1.1529717 * blue,
    green: -0.1302571 * red + 1.1408029 * green - 0.0105485 * blue,
    red: 1.7050515 * red - 0.6217907 * green - 0.0832584 * blue,
  };
  const l = Math.cbrt(0.41222146 * srgb.red + 0.53633255 * srgb.green + 0.051445995 * srgb.blue);
  const m = Math.cbrt(0.2119035 * srgb.red + 0.6806995 * srgb.green + 0.10739696 * srgb.blue);
  const s = Math.cbrt(0.08830246 * srgb.red + 0.28171885 * srgb.green + 0.6299787 * srgb.blue);
  return [
    0.21045426 * l + 0.7936178 * m - 0.004072047 * s,
    1.9779985 * l - 2.4285922 * m + 0.4505937 * s,
    0.025904037 * l + 0.78277177 * m - 0.80867577 * s,
  ];
};

const smoothstep = (low: number, high: number, value: number) => {
  const position = clamp01((value - low) / (high - low));
  return position * position * (3 - 2 * position);
};

export const continuousMonochromeTarget = (hueDegrees: number): Partial<Record<BlackWhiteMixerChannel, number>> => {
  const hue = ((hueDegrees % 360) + 360) % 360;
  for (let index = 0; index < CONTINUOUS_ANCHORS.length; index += 1) {
    const next = (index + 1) % CONTINUOUS_ANCHORS.length;
    const start = CONTINUOUS_ANCHORS[index];
    const end = CONTINUOUS_ANCHORS[next] ?? CONTINUOUS_ANCHORS[0];
    if (!start || !end) continue;
    const endHue = next === 0 ? 360 : end.hue;
    if (start && hue >= start.hue && hue <= endHue) {
      const position = (hue - start.hue) / (endHue - start.hue);
      const blend = 0.5 - 0.5 * Math.cos(Math.PI * position);
      return { [start.key]: 1 - blend, [end.key]: blend };
    }
  }
  return { reds: 1 };
};

export const applyTargetedMonochromeMix = (
  value: unknown,
  sourcePixel: RgbPixel,
  delta: number,
): BlackWhiteMixerSettings => {
  const settings = parseBlackWhiteMixerSettings(value);
  if (settings.sourceClass !== 'color_source') return settings;
  const [, a, b] = ap1ToOklab(sourcePixel);
  const chroma = Math.hypot(a, b);
  if (chroma < 0.005) return settings;
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const target = continuousMonochromeTarget(hue);
  const weights = { ...settings.weights };
  for (const [key, influence] of Object.entries(target) as Array<[BlackWhiteMixerChannel, number]>) {
    weights[key] = Math.min(100, Math.max(-100, weights[key] + delta * influence));
  }
  return { ...settings, enabled: true, presetId: 'manual', process: 'continuous_sensitivity_v1', weights };
};

export function applyBlackWhiteMixerToRgbPixel(pixel: RgbPixel, value: unknown): BlackWhiteMixerRuntimeResult {
  const settings = parseBlackWhiteMixerSettings(value);
  const sanitized = {
    blue: sanitizeSceneChannel(pixel.blue),
    green: sanitizeSceneChannel(pixel.green),
    red: sanitizeSceneChannel(pixel.red),
  };
  const luminance = acesCgLuminance(sanitized);

  const responseValues = Object.values(settings.weights).map((weight) => weight / 100);
  const responseMin = Math.max(-2, Math.min(2, Math.min(...responseValues)));
  const responseMax = Math.max(-2, Math.min(2, Math.max(...responseValues)));
  const receipt = (outputRgb: RgbPixel): MonochromeRuntimeReceiptV1 => ({
    equalChannelOutput:
      Math.abs(outputRgb.red - outputRgb.green) <= 1e-5 && Math.abs(outputRgb.green - outputRgb.blue) <= 1e-5,
    implementationVersion: 1,
    inputHeadroomPreserved:
      Object.values(sanitized).some((channel) => Math.abs(channel) > 1) &&
      Object.values(outputRgb).some((channel) => Math.abs(channel) > 1),
    neutralMix: [0.27222872, 0.67408174, 0.05368952],
    process: settings.process,
    responseBoundsEv: [responseMin, responseMax],
    sourceClass: settings.sourceClass,
  });

  if (!settings.enabled) {
    const outputRgb = { ...pixel };
    return {
      influence: {},
      luminance,
      outputRgb,
      receipt: receipt(outputRgb),
      weightedAdjustment: 0,
    };
  }

  if (settings.process === 'neutral_panchromatic_v1' || settings.sourceClass !== 'color_source') {
    const outputRgb = { blue: luminance, green: luminance, red: luminance };
    return {
      influence: {},
      luminance,
      outputRgb,
      receipt: receipt(outputRgb),
      weightedAdjustment: 0,
    };
  }

  const [, a, b] = ap1ToOklab(sanitized);
  const chroma = Math.hypot(a, b);
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const influence = continuousMonochromeTarget(hue);
  const responseEv = (Object.entries(influence) as Array<[BlackWhiteMixerChannel, number]>).reduce(
    (sum, [key, weight]) => sum + (settings.weights[key] / 100) * weight,
    0,
  );
  const weightedAdjustment = responseEv * smoothstep(0.005, 0.08, chroma);
  const mixed = luminance * 2 ** Math.min(2, Math.max(-2, weightedAdjustment));
  const outputRgb = { blue: mixed, green: mixed, red: mixed };

  return {
    influence,
    luminance,
    outputRgb,
    receipt: receipt(outputRgb),
    weightedAdjustment,
  };
}
