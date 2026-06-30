import {
  NEGATIVE_LAB_FRAME_EXPOSURE_MAX_EV,
  NEGATIVE_LAB_FRAME_EXPOSURE_MIN_EV,
  NEGATIVE_LAB_FRAME_EXPOSURE_OVERRIDE_SCHEMA_VERSION,
  NEGATIVE_LAB_FRAME_EXPOSURE_STEP_EV,
  type NegativeLabFrameExposureOverride,
  type NegativeLabFrameExposureOverridePayload,
  parseNegativeLabFrameExposureOverridePayload,
} from '../../schemas/negative-lab/negativeLabFrameExposureOverrideSchemas';

import type { NegativeLabFrameHealthEntry } from '../../schemas/negative-lab/negativeLabFrameHealthSchemas';

export const snapNegativeLabFrameExposureOffset = (value: number): number => {
  const finiteValue = Number.isFinite(value) ? value : 0;
  const clampedValue = Math.min(
    Math.max(finiteValue, NEGATIVE_LAB_FRAME_EXPOSURE_MIN_EV),
    NEGATIVE_LAB_FRAME_EXPOSURE_MAX_EV,
  );
  return Number(
    (Math.round(clampedValue / NEGATIVE_LAB_FRAME_EXPOSURE_STEP_EV) * NEGATIVE_LAB_FRAME_EXPOSURE_STEP_EV).toFixed(2),
  );
};

export const buildNegativeLabFrameExposureOverridePayload = ({
  baselineExposure,
  frameHealthRows,
  offsetsByFrameId,
}: {
  baselineExposure: number;
  frameHealthRows: readonly NegativeLabFrameHealthEntry[];
  offsetsByFrameId: Readonly<Record<string, number>>;
}): NegativeLabFrameExposureOverridePayload => {
  const overrides = frameHealthRows.flatMap<NegativeLabFrameExposureOverride>((frame) => {
    const offset = snapNegativeLabFrameExposureOffset(offsetsByFrameId[frame.frameId] ?? 0);
    if (offset === 0) return [];
    return [
      {
        effectiveExposure: Number((baselineExposure + offset).toFixed(2)),
        exposureOffset: offset,
        frameId: frame.frameId,
        sourcePath: frame.sourcePath,
      },
    ];
  });

  return parseNegativeLabFrameExposureOverridePayload({
    overrides,
    schemaVersion: NEGATIVE_LAB_FRAME_EXPOSURE_OVERRIDE_SCHEMA_VERSION,
  });
};

export const getNegativeLabEffectiveFrameExposure = ({
  baselineExposure,
  frameId,
  offsetsByFrameId,
}: {
  baselineExposure: number;
  frameId: string | null;
  offsetsByFrameId: Readonly<Record<string, number>>;
}): number => {
  if (frameId === null) return baselineExposure;
  return Number((baselineExposure + snapNegativeLabFrameExposureOffset(offsetsByFrameId[frameId] ?? 0)).toFixed(2));
};
