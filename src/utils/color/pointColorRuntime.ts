import type {
  PerceptualColorCoordinateV1,
  PointColorAdjustmentV1,
  SkinUniformityV1,
} from '../../../packages/rawengine-schema/src/color/pointColorSchemas';

export const circularHueDistanceDegrees = (left: number, right: number): number => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const pointColorMembershipWeight = (
  color: PerceptualColorCoordinateV1,
  point: PointColorAdjustmentV1,
): number => {
  if (!point.enabled || point.samples.length === 0) return 0;
  const union = point.samples.reduce((currentUnion, sample) => {
    const chromaGate = smoothstep(0.003, 0.02, Math.min(color.chroma, sample.sourceColor.chroma));
    const hueDistance =
      circularHueDistanceDegrees(color.hueDegrees, sample.sourceColor.hueDegrees) /
      Math.max(point.hueRadiusDegrees, 0.1);
    const chromaDistance = Math.abs(color.chroma - sample.sourceColor.chroma) / Math.max(point.chromaRadius, 0.001);
    const lightnessDistance =
      Math.abs(color.lightness - sample.sourceColor.lightness) / Math.max(point.lightnessRadius, 0.001);
    const normalized =
      Math.hypot(hueDistance, chromaDistance, lightnessDistance) / Math.max(0.25, Math.min(4, point.variance));
    const weight =
      (1 - smoothstep(Math.max(0, 1 - Math.max(0, Math.min(1, point.feather))), 1, normalized)) *
      chromaGate *
      Math.max(0, Math.min(1, sample.confidence));
    return 1 - (1 - currentUnion) * (1 - weight);
  }, 0);
  return union * Math.max(0, Math.min(1, point.opacity));
};

export const applyPointColorCoordinate = (
  color: PerceptualColorCoordinateV1,
  point: PointColorAdjustmentV1,
): PerceptualColorCoordinateV1 => {
  const weight = pointColorMembershipWeight(color, point);
  const saturation = color.chroma / Math.max(color.lightness, 0.01);
  const shiftedSaturation = Math.max(0, saturation * (1 + point.saturationShift * weight));
  return {
    chroma: Math.max(0, color.chroma + point.chromaShift * weight, shiftedSaturation * Math.max(color.lightness, 0.01)),
    hueDegrees: (color.hueDegrees + point.hueShiftDegrees * weight + 360) % 360,
    lightness: color.lightness + point.lightnessShift * weight,
  };
};

export const applySkinUniformityCoordinate = (
  color: PerceptualColorCoordinateV1,
  skin: SkinUniformityV1,
): PerceptualColorCoordinateV1 => {
  if (!skin.enabled || skin.range === null || skin.target === null) return color;
  const membership = pointColorMembershipWeight(color, skin.range);
  const extreme = Math.max(
    0,
    Math.min(1, smoothstep(0, 0.12, color.lightness) + 1 - smoothstep(0.82, 1, color.lightness)),
  );
  const influence = membership * (1 - skin.preserveExtremes * extreme);
  const hueDelta = ((skin.target.hueDegrees - color.hueDegrees + 540) % 360) - 180;
  return {
    chroma: color.chroma + (skin.target.chroma - color.chroma) * skin.chromaUniformity * influence,
    hueDegrees: (color.hueDegrees + hueDelta * skin.hueUniformity * influence + 360) % 360,
    lightness: color.lightness + (skin.target.lightness - color.lightness) * skin.lightnessUniformity * influence,
  };
};

// Visualization and mask rasterization deliberately expose the same evaluator.
export const pointColorVisualizationWeight = pointColorMembershipWeight;
export const pointColorMaskWeight = pointColorMembershipWeight;
