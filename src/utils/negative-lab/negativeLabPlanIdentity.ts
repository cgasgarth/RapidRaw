import type { NegativeLabPresetParams } from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import type { NegativeLabSelectedProfileSnapshot } from '../../schemas/negative-lab/negativeLabProfileComparisonSchemas';

import type { NegativeLabOutputFormatId } from './negativeLabOutputFormatIds';

export interface NegativeLabAcceptedApplyPlanFingerprintInput {
  dryRunPlanJson: string;
  outputFormat: NegativeLabOutputFormatId;
  params: NegativeLabPresetParams;
  pathsToConvert: readonly string[];
  selectedProfileSnapshot: NegativeLabSelectedProfileSnapshot | null;
  suffix: string;
  writeConversionBundle: boolean;
}

export const buildNegativeLabPlanHash = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

export const buildNegativeLabAcceptedPlanIdentity = (planJson: string) => {
  const planHash = buildNegativeLabPlanHash(planJson);

  return {
    acceptedDryRunPlanHash: `fnv1a32:${planHash}`,
    acceptedDryRunPlanId: `negative_lab_batch_plan_${planHash}`,
  };
};

export const buildNegativeLabAcceptedApplyPlanFingerprint = ({
  dryRunPlanJson,
  outputFormat,
  params,
  pathsToConvert,
  selectedProfileSnapshot,
  suffix,
  writeConversionBundle,
}: NegativeLabAcceptedApplyPlanFingerprintInput): string =>
  JSON.stringify(
    {
      dryRunPlanJson,
      outputFormat,
      params,
      pathsToConvert,
      selectedProfileSnapshot,
      suffix,
      writeConversionBundle,
    },
    null,
    2,
  );

export const isNegativeLabAcceptedApplyPlanCurrent = ({
  acceptedApplyPlanFingerprint,
  currentApplyPlanFingerprint,
}: {
  acceptedApplyPlanFingerprint: string | null;
  currentApplyPlanFingerprint: string;
}): boolean => acceptedApplyPlanFingerprint === currentApplyPlanFingerprint;
