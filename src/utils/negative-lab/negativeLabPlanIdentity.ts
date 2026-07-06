import type { NegativeLabPresetParams } from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import type { NegativeLabSelectedProfileSnapshot } from '../../schemas/negative-lab/negativeLabProfileComparisonSchemas';

import type { NegativeLabOutputFormatId } from './negativeLabOutputFormatIds';

export interface NegativeLabAcceptedApplyPlanFingerprintInput {
  dryRunPlanJson: string;
  outputFormat: NegativeLabOutputFormatId;
  params: NegativeLabPresetParams;
  pathsToConvert: readonly string[];
  selectedProfileSnapshot: NegativeLabSelectedProfileSnapshot | null;
  sessionRevision: number;
  suffix: string;
  writeConversionBundle: boolean;
}

export type NegativeLabAcceptedApplyPlanStaleReason =
  | 'conversion_params_changed'
  | 'dry_run_plan_changed'
  | 'output_format_changed'
  | 'output_options_changed'
  | 'selected_profile_changed'
  | 'session_revision_changed'
  | 'source_paths_changed'
  | 'unparseable_fingerprint';

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
  sessionRevision,
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
      sessionRevision,
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
}): boolean => {
  if (acceptedApplyPlanFingerprint === currentApplyPlanFingerprint) return true;

  const accepted = parseFingerprint(acceptedApplyPlanFingerprint);
  const current = parseFingerprint(currentApplyPlanFingerprint);
  if (accepted === null || current === null) return false;

  return accepted.sessionRevision === current.sessionRevision;
};

const parseFingerprint = (fingerprint: string | null): NegativeLabAcceptedApplyPlanFingerprintInput | null => {
  if (fingerprint === null) return null;
  try {
    return JSON.parse(fingerprint) as NegativeLabAcceptedApplyPlanFingerprintInput;
  } catch {
    return null;
  }
};

const stableValueChanged = (left: unknown, right: unknown): boolean => JSON.stringify(left) !== JSON.stringify(right);

export const getNegativeLabAcceptedApplyPlanStaleReasons = ({
  acceptedApplyPlanFingerprint,
  currentApplyPlanFingerprint,
}: {
  acceptedApplyPlanFingerprint: string | null;
  currentApplyPlanFingerprint: string;
}): NegativeLabAcceptedApplyPlanStaleReason[] => {
  if (acceptedApplyPlanFingerprint === null || acceptedApplyPlanFingerprint === currentApplyPlanFingerprint) return [];

  const accepted = parseFingerprint(acceptedApplyPlanFingerprint);
  const current = parseFingerprint(currentApplyPlanFingerprint);
  if (accepted === null || current === null) return ['unparseable_fingerprint'];
  if (accepted.sessionRevision !== current.sessionRevision) return ['session_revision_changed'];

  const reasons: NegativeLabAcceptedApplyPlanStaleReason[] = [];
  if (accepted.dryRunPlanJson !== current.dryRunPlanJson) reasons.push('dry_run_plan_changed');
  if (stableValueChanged(accepted.pathsToConvert, current.pathsToConvert)) reasons.push('source_paths_changed');
  if (stableValueChanged(accepted.params, current.params)) reasons.push('conversion_params_changed');
  if (accepted.outputFormat !== current.outputFormat) reasons.push('output_format_changed');
  if (stableValueChanged(accepted.selectedProfileSnapshot, current.selectedProfileSnapshot)) {
    reasons.push('selected_profile_changed');
  }
  if (accepted.suffix !== current.suffix || accepted.writeConversionBundle !== current.writeConversionBundle) {
    reasons.push('output_options_changed');
  }

  return reasons;
};
