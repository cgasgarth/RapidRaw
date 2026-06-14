export const DEFAULT_SELECTIVE_COLOR_FALLOFF_SHARPNESS = 1.5;

const wrapHueDistance = (leftHueDegrees: number, rightHueDegrees: number) => {
  const rawDistance = Math.abs(leftHueDegrees - rightHueDegrees);
  return Math.min(rawDistance, 360 - rawDistance);
};

export interface SelectiveColorFalloffOptions {
  centerHueDegrees: number;
  hueDegrees: number;
  smoothness: number;
  widthDegrees: number;
}

export const calculateSelectiveColorInfluence = ({
  centerHueDegrees,
  hueDegrees,
  smoothness,
  widthDegrees,
}: SelectiveColorFalloffOptions) => {
  if (widthDegrees <= 0) return 0;

  const distance = wrapHueDistance(hueDegrees, centerHueDegrees);
  const falloff = distance / (widthDegrees * 0.5);
  return Math.exp(-smoothness * falloff * falloff);
};

export const calculateDefaultSelectiveColorInfluence = (options: Omit<SelectiveColorFalloffOptions, 'smoothness'>) =>
  calculateSelectiveColorInfluence({ ...options, smoothness: DEFAULT_SELECTIVE_COLOR_FALLOFF_SHARPNESS });
