export type SelectiveColorRangeKey =
  | 'reds'
  | 'oranges'
  | 'yellows'
  | 'greens'
  | 'aquas'
  | 'blues'
  | 'purples'
  | 'magentas';

export interface SelectiveColorRange {
  centerHueDegrees: number;
  color: string;
  key: SelectiveColorRangeKey;
  labelKey: `adjustments.color.mixerColors.${SelectiveColorRangeKey}`;
  widthDegrees: number;
}

export interface SelectiveColorRangeControl {
  centerHueDegrees: number;
  falloffSmoothness: number;
  widthDegrees: number;
}

const RED_SELECTIVE_COLOR_RANGE: SelectiveColorRange = {
  centerHueDegrees: 358,
  color: '#f87171',
  key: 'reds',
  labelKey: 'adjustments.color.mixerColors.reds',
  widthDegrees: 35,
};

export const SELECTIVE_COLOR_RANGES: Array<SelectiveColorRange> = [
  RED_SELECTIVE_COLOR_RANGE,
  {
    centerHueDegrees: 25,
    color: '#fb923c',
    key: 'oranges',
    labelKey: 'adjustments.color.mixerColors.oranges',
    widthDegrees: 45,
  },
  {
    centerHueDegrees: 60,
    color: '#facc15',
    key: 'yellows',
    labelKey: 'adjustments.color.mixerColors.yellows',
    widthDegrees: 40,
  },
  {
    centerHueDegrees: 115,
    color: '#4ade80',
    key: 'greens',
    labelKey: 'adjustments.color.mixerColors.greens',
    widthDegrees: 90,
  },
  {
    centerHueDegrees: 180,
    color: '#2dd4bf',
    key: 'aquas',
    labelKey: 'adjustments.color.mixerColors.aquas',
    widthDegrees: 60,
  },
  {
    centerHueDegrees: 225,
    color: '#60a5fa',
    key: 'blues',
    labelKey: 'adjustments.color.mixerColors.blues',
    widthDegrees: 60,
  },
  {
    centerHueDegrees: 280,
    color: '#a78bfa',
    key: 'purples',
    labelKey: 'adjustments.color.mixerColors.purples',
    widthDegrees: 55,
  },
  {
    centerHueDegrees: 330,
    color: '#f472b6',
    key: 'magentas',
    labelKey: 'adjustments.color.mixerColors.magentas',
    widthDegrees: 50,
  },
];

export const SELECTIVE_COLOR_RANGE_KEYS = SELECTIVE_COLOR_RANGES.map((range) => range.key);

export const getSelectiveColorRange = (key: string) =>
  SELECTIVE_COLOR_RANGES.find((range) => range.key === key) ?? RED_SELECTIVE_COLOR_RANGE;

export const DEFAULT_SELECTIVE_COLOR_RANGE_CONTROLS: Record<SelectiveColorRangeKey, SelectiveColorRangeControl> =
  Object.fromEntries(
    SELECTIVE_COLOR_RANGES.map((range) => [
      range.key,
      {
        centerHueDegrees: range.centerHueDegrees,
        falloffSmoothness: 1.5,
        widthDegrees: range.widthDegrees,
      },
    ]),
  ) as Record<SelectiveColorRangeKey, SelectiveColorRangeControl>;

const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
};

const wrapHue = (value: number) => ((value % 360) + 360) % 360;

export const normalizeSelectiveColorRangeControl = (
  rangeKey: SelectiveColorRangeKey,
  control: Partial<SelectiveColorRangeControl> | null | undefined,
): SelectiveColorRangeControl => {
  const fallback = DEFAULT_SELECTIVE_COLOR_RANGE_CONTROLS[rangeKey];

  return {
    centerHueDegrees: wrapHue(control?.centerHueDegrees ?? fallback.centerHueDegrees),
    falloffSmoothness: clamp(control?.falloffSmoothness ?? fallback.falloffSmoothness, 0.25, 4),
    widthDegrees: clamp(control?.widthDegrees ?? fallback.widthDegrees, 10, 180),
  };
};
