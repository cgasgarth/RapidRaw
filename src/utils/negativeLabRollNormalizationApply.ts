import type { NegativeLabFrameRgbBalanceOffset } from '../schemas/negative-lab/negativeLabFrameRgbBalanceOverrideSchemas';
import type { NegativeLabPresetParams } from '../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import type { NegativeLabRollNormalizationPlan } from '../schemas/negative-lab/negativeLabRollNormalizationSchemas';
import { snapNegativeLabFrameExposureOffset } from './negativeLabFrameExposureOverrides';
import {
  negativeLabFrameRgbBalanceOffsetIsZero,
  snapNegativeLabFrameRgbBalanceOffsets,
} from './negativeLabFrameRgbBalanceOverrides';

export interface NegativeLabRollNormalizationAcceptedPlanIdentity {
  acceptedDryRunPlanHash: string;
  acceptedDryRunPlanId: string;
}

export interface NegativeLabRollNormalizationOffsetState {
  frameExposureOffsetByFrameId: Record<string, number>;
  frameRgbBalanceOffsetByFrameId: Record<string, NegativeLabFrameRgbBalanceOffset>;
}

export interface NegativeLabRollNormalizationApplyReceipt extends NegativeLabRollNormalizationAcceptedPlanIdentity {
  appliedFrameCount: number;
  exposureOverrideCount: number;
  manualExposurePreservedFrameIds: string[];
  manualRgbPreservedFrameIds: string[];
  previousFrameExposureOffsetByFrameId: Record<string, number>;
  previousFrameRgbBalanceOffsetByFrameId: Record<string, NegativeLabFrameRgbBalanceOffset>;
  restored: boolean;
  restoreRevision: number;
  reviewFrameCount: number;
  rgbBalanceOverrideCount: number;
  skippedFrameCount: number;
}

export interface NegativeLabRollNormalizationRestoreReceipt extends NegativeLabRollNormalizationAcceptedPlanIdentity {
  restoredExposureOverrideCount: number;
  restoredFrameCount: number;
  restoredRevision: number;
  restoredRgbBalanceOverrideCount: number;
}

const hasOwn = <T extends object>(value: T, key: string): key is Extract<keyof T, string> => Object.hasOwn(value, key);

export const applyNegativeLabRollNormalizationPlan = ({
  acceptedPlanIdentity,
  baselineParams,
  currentState,
  plan,
  restoreRevision,
  reviewFrameCount,
  skippedFrameCount,
}: {
  acceptedPlanIdentity: NegativeLabRollNormalizationAcceptedPlanIdentity;
  baselineParams: NegativeLabPresetParams;
  currentState: NegativeLabRollNormalizationOffsetState;
  plan: NegativeLabRollNormalizationPlan;
  restoreRevision: number;
  reviewFrameCount: number;
  skippedFrameCount: number;
}): {
  nextState: NegativeLabRollNormalizationOffsetState;
  receipt: NegativeLabRollNormalizationApplyReceipt;
} => {
  const nextExposureOffsets = { ...currentState.frameExposureOffsetByFrameId };
  for (const override of plan.exposureOverrides.overrides) {
    if (hasOwn(currentState.frameExposureOffsetByFrameId, override.frameId)) continue;
    const snappedOffset = snapNegativeLabFrameExposureOffset(override.exposureOffset);
    if (snappedOffset !== 0) {
      nextExposureOffsets[override.frameId] = snappedOffset;
    }
  }

  const nextRgbOffsetsByFrameId = { ...currentState.frameRgbBalanceOffsetByFrameId };
  for (const override of plan.rgbBalanceOverrides.overrides) {
    if (hasOwn(currentState.frameRgbBalanceOffsetByFrameId, override.frameId)) continue;
    const snappedOffset = snapNegativeLabFrameRgbBalanceOffsets({
      baselineParams,
      offsets: override.rgbBalanceOffset,
    });
    if (!negativeLabFrameRgbBalanceOffsetIsZero(snappedOffset)) {
      nextRgbOffsetsByFrameId[override.frameId] = snappedOffset;
    }
  }

  return {
    nextState: {
      frameExposureOffsetByFrameId: nextExposureOffsets,
      frameRgbBalanceOffsetByFrameId: nextRgbOffsetsByFrameId,
    },
    receipt: {
      ...acceptedPlanIdentity,
      appliedFrameCount: plan.affectedFrameIds.length,
      exposureOverrideCount: plan.exposureOverrides.overrides.length,
      manualExposurePreservedFrameIds: plan.exposureOverrides.overrides
        .map((override) => override.frameId)
        .filter((frameId) => hasOwn(currentState.frameExposureOffsetByFrameId, frameId)),
      manualRgbPreservedFrameIds: plan.rgbBalanceOverrides.overrides
        .map((override) => override.frameId)
        .filter((frameId) => hasOwn(currentState.frameRgbBalanceOffsetByFrameId, frameId)),
      previousFrameExposureOffsetByFrameId: { ...currentState.frameExposureOffsetByFrameId },
      previousFrameRgbBalanceOffsetByFrameId: { ...currentState.frameRgbBalanceOffsetByFrameId },
      restored: false,
      restoreRevision,
      reviewFrameCount,
      rgbBalanceOverrideCount: plan.rgbBalanceOverrides.overrides.length,
      skippedFrameCount,
    },
  };
};

export const restoreNegativeLabRollNormalizationOverrides = (
  receipt: NegativeLabRollNormalizationApplyReceipt,
): {
  nextState: NegativeLabRollNormalizationOffsetState;
  receipt: NegativeLabRollNormalizationRestoreReceipt;
} => ({
  nextState: {
    frameExposureOffsetByFrameId: { ...receipt.previousFrameExposureOffsetByFrameId },
    frameRgbBalanceOffsetByFrameId: { ...receipt.previousFrameRgbBalanceOffsetByFrameId },
  },
  receipt: {
    acceptedDryRunPlanHash: receipt.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: receipt.acceptedDryRunPlanId,
    restoredExposureOverrideCount: Object.keys(receipt.previousFrameExposureOffsetByFrameId).length,
    restoredFrameCount: new Set([
      ...Object.keys(receipt.previousFrameExposureOffsetByFrameId),
      ...Object.keys(receipt.previousFrameRgbBalanceOffsetByFrameId),
    ]).size,
    restoredRevision: receipt.restoreRevision,
    restoredRgbBalanceOverrideCount: Object.keys(receipt.previousFrameRgbBalanceOffsetByFrameId).length,
  },
});
