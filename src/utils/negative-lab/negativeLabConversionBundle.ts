import {
  type NegativeLabConversionBundle,
  negativeLabConversionBundleSchema,
} from '../../schemas/negative-lab/negativeLabConversionBundleSchemas';
import type { NegativeLabSessionRecipeState } from '../../schemas/negative-lab/negativeLabSessionStateSchemas';
import { buildNegativeLabConversionPlanResult } from './app-server/negativeLabAppServerRoutes';
import { createNegativeLabSessionState, type NegativeLabSessionSnapshot } from './negativeLabSessionState';

export interface NegativeLabConversionBundleReplayProof {
  outputCount: number;
  outputFormat: NegativeLabConversionBundle['conversion']['outputFormat'];
  profileProvenanceHash: string;
  replayIdentityHash: string;
}

export type NegativeLabConversionBundleReplayStatus = 'compatible' | 'review_required' | 'blocked';

export type NegativeLabConversionBundleReplayReason =
  | 'source_path_mismatch'
  | 'source_content_hash_mismatch'
  | 'source_identity_missing'
  | 'profile_provenance_mismatch'
  | 'acquisition_profile_mismatch'
  | 'unsupported_output_format';

export interface NegativeLabConversionBundleReplaySource {
  acquisitionProfileId?: string;
  contentHash?: string;
  path: string;
  profileProvenanceHash?: string;
}

export interface NegativeLabConversionBundleReplayReport {
  acknowledged: boolean;
  bundleIdentityHash: string;
  reasons: NegativeLabConversionBundleReplayReason[];
  status: NegativeLabConversionBundleReplayStatus;
  sourcePaths: string[];
}

export interface NegativeLabConversionBundleReplayResult {
  report: NegativeLabConversionBundleReplayReport;
  snapshot: NegativeLabSessionSnapshot;
}

const numbersNear = (left: number, right: number) => Math.abs(left - right) < 0.000001;

const paramsNear = (
  left: NegativeLabConversionBundle['conversion']['params'],
  right: NegativeLabConversionBundle['conversion']['params'],
) =>
  numbersNear(left.base_fog_strength, right.base_fog_strength) &&
  numbersNear(left.black_point, right.black_point) &&
  numbersNear(left.blue_weight, right.blue_weight) &&
  numbersNear(left.contrast, right.contrast) &&
  left.conversion_model === right.conversion_model &&
  left.render_intent === right.render_intent &&
  JSON.stringify(left.flat_log_master) === JSON.stringify(right.flat_log_master) &&
  numbersNear(left.exposure, right.exposure) &&
  numbersNear(left.green_weight, right.green_weight) &&
  left.print_curve_algorithm === right.print_curve_algorithm &&
  left.print_curve_output_tag === right.print_curve_output_tag &&
  JSON.stringify(left.print_curve_v2) === JSON.stringify(right.print_curve_v2) &&
  numbersNear(left.red_weight, right.red_weight) &&
  numbersNear(left.white_point, right.white_point) &&
  JSON.stringify(left.base_fog_sample) === JSON.stringify(right.base_fog_sample);

const basenameOf = (path: string): string => {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
};

export const validateNegativeLabConversionBundleReplay = (value: unknown): NegativeLabConversionBundleReplayProof => {
  const bundle = negativeLabConversionBundleSchema.parse(value);
  const selectedProfile = bundle.conversion.selectedProfile;

  if (selectedProfile === null || bundle.conversion.profileProvenanceHash === null) {
    throw new Error('Negative Lab conversion bundle replay requires a selected runtime profile.');
  }

  const conversionPlan = buildNegativeLabConversionPlanResult({
    outputFormat: bundle.conversion.outputFormat,
    flatLogMaster: bundle.conversion.flatLogMaster,
    paths: bundle.outputs.map((output) => output.source.path),
    presetId: selectedProfile.presetId,
    sampleRect: bundle.conversion.params.base_fog_sample,
    scope: bundle.outputs.length > 1 ? 'all' : 'active',
    suffix: bundle.conversion.suffix,
    renderIntent: bundle.conversion.renderIntent,
  });

  if (conversionPlan.profileProvenanceHash !== selectedProfile.profileProvenanceHash) {
    throw new Error('Negative Lab conversion bundle replay profile provenance does not match app-server plan.');
  }

  if (!paramsNear(conversionPlan.params, bundle.conversion.params)) {
    throw new Error('Negative Lab conversion bundle replay params do not match app-server plan.');
  }

  if (
    conversionPlan.outputFormat !== bundle.conversion.outputFormat ||
    conversionPlan.suffix !== bundle.conversion.suffix
  ) {
    throw new Error('Negative Lab conversion bundle replay export settings do not match app-server plan.');
  }

  for (const output of bundle.outputs) {
    if (output.path === output.source.path || basenameOf(output.path) === basenameOf(output.source.path)) {
      throw new Error('Negative Lab conversion bundle replay output would overwrite the source negative.');
    }
  }

  return {
    outputCount: bundle.outputs.length,
    outputFormat: bundle.conversion.outputFormat,
    profileProvenanceHash: conversionPlan.profileProvenanceHash,
    replayIdentityHash: bundle.replay.identityHash,
  };
};

const buildReplayRecipeState = (bundle: NegativeLabConversionBundle): NegativeLabSessionRecipeState => ({
  conversionScope: bundle.outputs.length > 1 ? 'all' : 'active',
  openSavedPositiveInEditor: true,
  params: bundle.conversion.params,
  patchSamplerCorrectionPayload: bundle.conversion.patchSamplerCorrections,
  saveOptions: {
    outputFormat: bundle.conversion.outputFormat,
    suffix: bundle.conversion.suffix,
    writeConversionBundle: true,
  },
  selectedAcquisitionProfileId: bundle.acquisition.selectedProfile.id,
  selectedPresetId: bundle.conversion.selectedProfile?.sourceGenericPresetId ?? '',
});

const buildReplayReport = (
  bundle: NegativeLabConversionBundle,
  source: NegativeLabConversionBundleReplaySource,
  acknowledged: boolean,
): NegativeLabConversionBundleReplayReport => {
  const expectedSources = bundle.outputs.map((output) => output.source);
  const reasons = new Set<NegativeLabConversionBundleReplayReason>();
  if (!expectedSources.some((expected) => expected.path === source.path)) reasons.add('source_path_mismatch');
  const expectedSource = expectedSources.find((expected) => expected.path === source.path);
  if (expectedSource === undefined || source.contentHash === undefined) reasons.add('source_identity_missing');
  if (
    expectedSource !== undefined &&
    source.contentHash !== undefined &&
    expectedSource.contentHash !== source.contentHash
  ) {
    reasons.add('source_content_hash_mismatch');
  }
  const bundleProfileHash = bundle.conversion.profileProvenanceHash;
  if (source.profileProvenanceHash !== undefined && bundleProfileHash !== source.profileProvenanceHash) {
    reasons.add('profile_provenance_mismatch');
  }
  if (
    source.acquisitionProfileId !== undefined &&
    bundle.acquisition.selectedProfile.id !== source.acquisitionProfileId
  ) {
    reasons.add('acquisition_profile_mismatch');
  }

  const blockingReason = reasons.has('source_path_mismatch') || reasons.has('source_content_hash_mismatch');
  const status: NegativeLabConversionBundleReplayStatus =
    blockingReason && !acknowledged ? 'blocked' : reasons.size > 0 ? 'review_required' : 'compatible';
  return {
    acknowledged,
    bundleIdentityHash: bundle.replay.identityHash,
    reasons: [...reasons],
    sourcePaths: expectedSources.map((expected) => expected.path),
    status,
  };
};

export const replayNegativeLabConversionBundle = ({
  acknowledged = false,
  bundleValue,
  sessionId,
  source,
  targetPaths,
}: {
  acknowledged?: boolean;
  bundleValue: unknown;
  sessionId: string;
  source: NegativeLabConversionBundleReplaySource;
  targetPaths: readonly string[];
}): NegativeLabConversionBundleReplayResult => {
  const bundle = negativeLabConversionBundleSchema.parse(bundleValue);
  const report = buildReplayReport(bundle, source, acknowledged);
  if (report.status === 'blocked') {
    throw new Error(`Negative Lab bundle replay blocked: ${report.reasons.join(',')}`);
  }

  const session = createNegativeLabSessionState(targetPaths, {
    recipeState: buildReplayRecipeState(bundle),
    sessionId,
  });
  return {
    report,
    snapshot: {
      ...session,
      proofState: {
        ...session.proofState,
        conversionBundleReplay: report,
      },
    },
  };
};
