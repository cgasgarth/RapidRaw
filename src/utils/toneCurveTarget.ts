import type { EditDocumentNodeParamsV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import { ActiveChannel, type Coord, type ParametricCurveSettings } from './adjustments';

export type ToneCurveTargetMode = 'point' | 'parametric';
export type ToneCurveTargetRegion = keyof ParametricCurveSettings | 'point';

export interface ToneCurveTargetSample {
  readonly channelValue: number;
  readonly normalizedLuma: number;
  readonly region: ToneCurveTargetRegion;
}

export const DEFAULT_TONE_CURVE_PARAMETRIC_SETTINGS: ParametricCurveSettings = {
  blackLevel: 0,
  darks: 0,
  highlights: 0,
  lights: 0,
  shadows: 0,
  split1: 25,
  split2: 50,
  split3: 75,
  whiteLevel: 0,
};

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

export const clampToneCurveSample = (value: number): number => clamp(Number.isFinite(value) ? value : 0, 0, 1);

export const toneCurveChannelValue = (
  channel: ActiveChannel,
  rgb: readonly [number, number, number],
  luma: number,
): number => {
  if (channel === ActiveChannel.Red) return clampToneCurveSample(rgb[0] ?? luma);
  if (channel === ActiveChannel.Green) return clampToneCurveSample(rgb[1] ?? luma);
  if (channel === ActiveChannel.Blue) return clampToneCurveSample(rgb[2] ?? luma);
  return clampToneCurveSample(luma);
};

export const toneCurveParametricRegion = (
  normalizedLuma: number,
  settings: ParametricCurveSettings,
): ToneCurveTargetRegion => {
  const value = clampToneCurveSample(normalizedLuma) * 100;
  if (value < settings.split1) return 'shadows';
  if (value < settings.split2) return 'darks';
  if (value < settings.split3) return 'lights';
  return 'highlights';
};

export const buildParametricCurvePoints = (settings: ParametricCurveSettings): Array<Coord> => {
  const vH = settings.highlights / 100;
  const vL = settings.lights / 100;
  const vD = settings.darks / 100;
  const vS = settings.shadows / 100;
  const s1 = settings.split1 / 100;
  const s2 = settings.split2 / 100;
  const s3 = settings.split3 / 100;
  const xs = [0, s1 / 2, s1, s2, s3, (s3 + 1) / 2, 1];
  const shadowX = xs[1] ?? 0;
  const highlightX = xs[5] ?? 0;
  const response = (value: number, x: number): number => {
    const headroom = value >= 0 ? 1 - x : x;
    return Math.tanh(value * 1.2) * 0.35 * Math.sqrt(headroom);
  };
  const ys = [
    0,
    shadowX + response(vS, shadowX),
    s1 + (response(vS, s1) + response(vD, s1)) / 2,
    s2 + (response(vD, s2) + response(vL, s2)) / 2,
    s3 + (response(vL, s3) + response(vH, s3)) / 2,
    highlightX + response(vH, highlightX),
    1,
  ];
  return xs.map((x, index) => ({ x: x * 255, y: clamp(ys[index] ?? x, 0, 1) * 255 }));
};

export const nearestToneCurvePointIndex = (points: readonly Coord[], x: number): number => {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const nextDistance = Math.abs(point.x - x);
    if (nextDistance < distance) {
      nearest = index;
      distance = nextDistance;
    }
  });
  return nearest;
};

export const updateToneCurvePoint = (
  params: EditDocumentNodeParamsV2<'scene_curve'>,
  channel: ActiveChannel,
  x: number,
  deltaY: number,
  selectedPointIndex: number | null,
): EditDocumentNodeParamsV2<'scene_curve'> => {
  const current = params.curves[channel];
  const selected = selectedPointIndex !== null && current[selectedPointIndex] !== undefined ? selectedPointIndex : null;
  const nearest = nearestToneCurvePointIndex(current, x);
  const targetIndex = selected ?? (Math.abs((current[nearest]?.x ?? x) - x) <= 20 ? nearest : -1);
  const points = current.map((point) => ({ ...point }));
  if (targetIndex < 0) {
    points.push({ x, y: clamp(x + deltaY, 0, 255) });
    points.sort((left, right) => left.x - right.x);
  } else {
    const point = points[targetIndex];
    if (point === undefined) return params;
    const minX = points[targetIndex - 1]?.x ?? 0;
    const maxX = points[targetIndex + 1]?.x ?? 255;
    point.x = clamp(point.x, minX + (targetIndex === 0 ? 0 : 1), maxX - (targetIndex === points.length - 1 ? 0 : 1));
    point.y = clamp(point.y + deltaY, 0, 255);
  }
  return {
    ...params,
    curves: { ...params.curves, [channel]: points },
    pointCurves: { ...params.pointCurves, [channel]: points.map((point) => ({ ...point })) },
  };
};

export const updateToneCurveParametric = (
  params: EditDocumentNodeParamsV2<'scene_curve'>,
  channel: ActiveChannel,
  region: ToneCurveTargetRegion,
  delta: number,
): EditDocumentNodeParamsV2<'scene_curve'> => {
  if (region === 'point' || !(region in params.parametricCurve[channel])) return params;
  const settings = params.parametricCurve[channel] ?? DEFAULT_TONE_CURVE_PARAMETRIC_SETTINGS;
  const limits: Record<string, readonly [number, number]> = {
    blackLevel: [0, 100],
    darks: [-100, 100],
    highlights: [-100, 100],
    lights: [-100, 100],
    shadows: [-100, 100],
    whiteLevel: [-100, 0],
  };
  const [minimum, maximum] = limits[region] ?? [-100, 100];
  const nextSettings = { ...settings, [region]: clamp((settings[region] as number) + delta, minimum, maximum) };
  return {
    ...params,
    parametricCurve: { ...params.parametricCurve, [channel]: nextSettings },
    curves: { ...params.curves, [channel]: buildParametricCurvePoints(nextSettings) },
  };
};
