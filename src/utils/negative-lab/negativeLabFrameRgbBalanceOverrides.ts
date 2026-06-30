import type { NegativeLabFrameHealthEntry } from '../../schemas/negative-lab/negativeLabFrameHealthSchemas';
import {
  NEGATIVE_LAB_FRAME_RGB_BALANCE_MAX_WEIGHT,
  NEGATIVE_LAB_FRAME_RGB_BALANCE_MIN_WEIGHT,
  NEGATIVE_LAB_FRAME_RGB_BALANCE_OVERRIDE_SCHEMA_VERSION,
  NEGATIVE_LAB_FRAME_RGB_BALANCE_STEP,
  type NegativeLabFrameRgbBalance,
  type NegativeLabFrameRgbBalanceOffset,
  type NegativeLabFrameRgbBalanceOverride,
  type NegativeLabFrameRgbBalanceOverridePayload,
  parseNegativeLabFrameRgbBalanceOverridePayload,
} from '../../schemas/negative-lab/negativeLabFrameRgbBalanceOverrideSchemas';
import type { NegativeLabPresetParams } from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';

export const DEFAULT_NEGATIVE_LAB_FRAME_RGB_BALANCE_OFFSET: NegativeLabFrameRgbBalanceOffset = {
  blueWeight: 0,
  greenWeight: 0,
  redWeight: 0,
};

const CHANNELS = ['blueWeight', 'greenWeight', 'redWeight'] as const;

const snapWeight = (value: number): number =>
  Number((Math.round(value / NEGATIVE_LAB_FRAME_RGB_BALANCE_STEP) * NEGATIVE_LAB_FRAME_RGB_BALANCE_STEP).toFixed(2));

const clampWeight = (value: number): number =>
  Math.min(Math.max(value, NEGATIVE_LAB_FRAME_RGB_BALANCE_MIN_WEIGHT), NEGATIVE_LAB_FRAME_RGB_BALANCE_MAX_WEIGHT);

export const negativeLabFrameRgbBalanceFromParams = (params: NegativeLabPresetParams): NegativeLabFrameRgbBalance => ({
  blueWeight: snapWeight(clampWeight(params.blue_weight)),
  greenWeight: snapWeight(clampWeight(params.green_weight)),
  redWeight: snapWeight(clampWeight(params.red_weight)),
});

export const snapNegativeLabFrameRgbBalanceOffset = ({
  baselineWeight,
  offset,
}: {
  baselineWeight: number;
  offset: number;
}): number => {
  const finiteOffset = Number.isFinite(offset) ? offset : 0;
  const effectiveWeight = snapWeight(clampWeight(baselineWeight + finiteOffset));
  return snapWeight(effectiveWeight - baselineWeight);
};

export const snapNegativeLabFrameRgbBalanceOffsets = ({
  baselineParams,
  offsets,
}: {
  baselineParams: NegativeLabPresetParams;
  offsets: Partial<NegativeLabFrameRgbBalanceOffset> | undefined;
}): NegativeLabFrameRgbBalanceOffset => ({
  blueWeight: snapNegativeLabFrameRgbBalanceOffset({
    baselineWeight: baselineParams.blue_weight,
    offset: offsets?.blueWeight ?? 0,
  }),
  greenWeight: snapNegativeLabFrameRgbBalanceOffset({
    baselineWeight: baselineParams.green_weight,
    offset: offsets?.greenWeight ?? 0,
  }),
  redWeight: snapNegativeLabFrameRgbBalanceOffset({
    baselineWeight: baselineParams.red_weight,
    offset: offsets?.redWeight ?? 0,
  }),
});

export const negativeLabFrameRgbBalanceOffsetIsZero = (offsets: NegativeLabFrameRgbBalanceOffset): boolean =>
  CHANNELS.every((channel) => offsets[channel] === 0);

export const getNegativeLabEffectiveFrameRgbBalance = ({
  baselineParams,
  frameId,
  offsetsByFrameId,
}: {
  baselineParams: NegativeLabPresetParams;
  frameId: string | null;
  offsetsByFrameId: Readonly<Record<string, NegativeLabFrameRgbBalanceOffset>>;
}): NegativeLabFrameRgbBalance => {
  const baseline = negativeLabFrameRgbBalanceFromParams(baselineParams);
  if (frameId === null) return baseline;
  const offsets = snapNegativeLabFrameRgbBalanceOffsets({
    baselineParams,
    offsets: offsetsByFrameId[frameId],
  });
  return {
    blueWeight: snapWeight(clampWeight(baseline.blueWeight + offsets.blueWeight)),
    greenWeight: snapWeight(clampWeight(baseline.greenWeight + offsets.greenWeight)),
    redWeight: snapWeight(clampWeight(baseline.redWeight + offsets.redWeight)),
  };
};

export const buildNegativeLabFrameRgbBalanceOverridePayload = ({
  baselineParams,
  frameHealthRows,
  offsetsByFrameId,
}: {
  baselineParams: NegativeLabPresetParams;
  frameHealthRows: readonly NegativeLabFrameHealthEntry[];
  offsetsByFrameId: Readonly<Record<string, NegativeLabFrameRgbBalanceOffset>>;
}): NegativeLabFrameRgbBalanceOverridePayload => {
  const overrides = frameHealthRows.flatMap<NegativeLabFrameRgbBalanceOverride>((frame) => {
    const rgbBalanceOffset = snapNegativeLabFrameRgbBalanceOffsets({
      baselineParams,
      offsets: offsetsByFrameId[frame.frameId],
    });
    if (negativeLabFrameRgbBalanceOffsetIsZero(rgbBalanceOffset)) return [];
    return [
      {
        frameId: frame.frameId,
        rgbBalanceOffset,
        sourcePath: frame.sourcePath,
      },
    ];
  });

  return parseNegativeLabFrameRgbBalanceOverridePayload({
    overrides,
    schemaVersion: NEGATIVE_LAB_FRAME_RGB_BALANCE_OVERRIDE_SCHEMA_VERSION,
  });
};
