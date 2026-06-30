import type { NegativeLabRuntimeProfileBrowserRow } from '../../schemas/negative-lab/negativeLabMeasuredProfileSchemas';
import type { NegativeLabPresetParams } from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import {
  type NegativeLabProfileComparisonRow,
  type NegativeLabSelectedProfileSnapshot,
  negativeLabProfileComparisonRowsSchema,
  negativeLabSelectedProfileSnapshotSchema,
} from '../../schemas/negative-lab/negativeLabProfileComparisonSchemas';
import { buildNegativeLabPlanHash } from './negativeLabPlanIdentity';

const PROFILE_DELTA_KEYS = [
  'exposure',
  'contrast',
  'black_point',
  'white_point',
  'base_fog_strength',
  'red_weight',
  'green_weight',
  'blue_weight',
] as const satisfies Array<keyof NegativeLabPresetParams>;

const roundProfileDelta = (value: number) => Math.round(value * 100) / 100;
const formatProfileDelta = (value: number) => (value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2));
const clampRgbChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const formatProfileHash = (payload: unknown): `fnv1a32:${string}` =>
  `fnv1a32:${buildNegativeLabPlanHash(JSON.stringify(payload))}`;
const profileParamsToCssRgb = (params: NegativeLabPresetParams): `rgb(${number} ${number} ${number})` => {
  const densityLift = params.base_fog_strength * 18;
  const exposureLift = params.exposure * 22;
  const contrastLift = (params.contrast - 1) * 28;
  const endpointLift = (params.black_point + (1 - params.white_point)) * 36;

  return `rgb(${clampRgbChannel(118 + densityLift + exposureLift + endpointLift + contrastLift + params.red_weight * 22)} ${clampRgbChannel(116 + densityLift + exposureLift + endpointLift + params.green_weight * 18)} ${clampRgbChannel(112 + densityLift + exposureLift + endpointLift - contrastLift + params.blue_weight * 24)})`;
};

const buildNegativeLabProfileComparisonWarningCodes = (profile: NegativeLabRuntimeProfileBrowserRow): string[] => {
  const warningCodes = new Set<string>();

  for (const limitation of profile.doesNotProve) {
    warningCodes.add(limitation);
  }

  if (!profile.isSelectable) {
    warningCodes.add(profile.disabledReason ?? 'profile_not_runtime_selectable');
  }
  if (profile.profileStatus === 'generic_unmeasured') {
    warningCodes.add('generic_starting_point_only');
  }
  if (profile.profileStatus === 'fixture_measured') {
    warningCodes.add('measured_process_family_only');
  }
  if (profile.profileStatus === 'user_supplied') {
    warningCodes.add('user_supplied_profile');
  }
  if (profile.params.base_fog_sample === null) {
    warningCodes.add('base_sample_reference_pending');
  }

  return [...warningCodes].sort();
};

const buildNegativeLabProfilePreviewSwatch = (
  currentParams: NegativeLabPresetParams,
  candidateParams: NegativeLabPresetParams,
) => {
  const currentCss = profileParamsToCssRgb(currentParams);
  const candidateCss = profileParamsToCssRgb(candidateParams);
  const warmthDelta = candidateParams.red_weight - candidateParams.blue_weight;

  return {
    candidateCss,
    currentCss,
    deltaCss: `linear-gradient(90deg, ${currentCss} 0 50%, ${candidateCss} 50% 100%)`,
    toneBias: warmthDelta > 0.03 ? 'warmer' : warmthDelta < -0.03 ? 'cooler' : 'neutral',
  };
};

const buildNegativeLabProfileComparisonRenderEvidence = ({
  activeFrameLabel,
  currentParams,
  profile,
  profileProvenanceHash,
  queuedCount,
}: {
  activeFrameLabel: string;
  currentParams: NegativeLabPresetParams;
  profile: NegativeLabRuntimeProfileBrowserRow;
  profileProvenanceHash: `fnv1a32:${string}`;
  queuedCount: number;
}) => {
  const metrics = {
    contrastDeltaAbs: roundProfileDelta(Math.abs(profile.params.contrast - currentParams.contrast)),
    exposureDeltaAbs: roundProfileDelta(Math.abs(profile.params.exposure - currentParams.exposure)),
    rgbBalanceDeltaAbs: roundProfileDelta(
      Math.abs(profile.params.red_weight - currentParams.red_weight) +
        Math.abs(profile.params.green_weight - currentParams.green_weight) +
        Math.abs(profile.params.blue_weight - currentParams.blue_weight),
    ),
  };
  const warningCodes = buildNegativeLabProfileComparisonWarningCodes(profile);
  const baseSampleReference =
    profile.params.base_fog_sample === null
      ? `active-frame:${activeFrameLabel}:pending-base-fog-sample`
      : `profile:${profile.presetId}:embedded-base-fog-sample`;
  const renderPayload = {
    activeFrameLabel,
    baseSampleReference,
    metrics,
    profileProvenanceHash,
    queuedCount,
    warningCodes,
  };

  return {
    baseSampleReference,
    densityAlgorithm: profile.params.print_curve_algorithm,
    metricHash: formatProfileHash({ metrics, profileProvenanceHash }),
    metrics,
    outputTag: profile.params.print_curve_output_tag,
    previewHash: formatProfileHash({
      currentParams,
      profileParams: profile.params,
      swatch: buildNegativeLabProfilePreviewSwatch(currentParams, profile.params),
    }),
    printCurveVersion:
      profile.params.print_curve_algorithm === 'negative_density_print_v2'
        ? ('density_print_v2' as const)
        : ('legacy_density_rgb_v1' as const),
    renderHash: formatProfileHash(renderPayload),
    warningCodes,
  };
};

export const buildNegativeLabBrowserProfileProvenanceHash = (
  profile: NegativeLabRuntimeProfileBrowserRow,
): `fnv1a32:${string}` =>
  `fnv1a32:${buildNegativeLabPlanHash(
    JSON.stringify({
      claimLevel: profile.claimLevel,
      claimPolicy: profile.claimPolicy,
      crosstalkProfile: profile.crosstalkProfile,
      displayName: profile.displayName,
      doesNotProve: profile.doesNotProve,
      evidenceFixtureCount: profile.evidenceFixtureCount,
      filmClass: profile.filmClass,
      measurementProfileId: profile.measurementProfileId,
      params: profile.params,
      presetId: profile.presetId,
      profileStatus: profile.profileStatus,
      runtimeStatus: profile.runtimeStatus,
      sourceGenericPresetId: profile.sourceGenericPresetId,
    }),
  )}`;

export const buildNegativeLabSelectedProfileSnapshot = (
  profile: NegativeLabRuntimeProfileBrowserRow,
  profileProvenanceHash: `fnv1a32:${string}`,
): NegativeLabSelectedProfileSnapshot =>
  negativeLabSelectedProfileSnapshotSchema.parse({
    claimLevel: profile.claimLevel,
    claimPolicy: profile.claimPolicy,
    crosstalkProfile: profile.crosstalkProfile,
    displayName: profile.displayName,
    doesNotProve: profile.doesNotProve,
    evidenceFixtureCount: profile.evidenceFixtureCount,
    filmClass: profile.filmClass,
    measurementProfileId: profile.measurementProfileId,
    params: profile.params,
    presetId: profile.presetId,
    profileProvenanceHash,
    profileStatus: profile.profileStatus,
    provenanceSummary: profile.provenanceSummary,
    runtimeStatus: profile.runtimeStatus,
    sourceGenericPresetId: profile.sourceGenericPresetId,
  });

export const buildNegativeLabProfileComparisonRows = ({
  activeFrameLabel,
  currentParams,
  profiles,
  profileProvenanceHashById,
  queuedCount,
  selectedPresetId,
}: {
  activeFrameLabel: string;
  currentParams: NegativeLabPresetParams;
  profiles: NegativeLabRuntimeProfileBrowserRow[];
  profileProvenanceHashById: ReadonlyMap<string, `fnv1a32:${string}`>;
  queuedCount: number;
  selectedPresetId: string;
}): NegativeLabProfileComparisonRow[] => {
  const selectableProfiles = profiles.filter((profile) => profile.isSelectable);
  const selectedProfile = selectableProfiles.find((profile) => profile.presetId === selectedPresetId);
  const userProfile = selectableProfiles.find((profile) => profile.profileStatus === 'user_supplied');
  const measuredProfile = selectableProfiles.find((profile) => profile.profileStatus === 'fixture_measured');
  const colorProfile = selectableProfiles.find((profile) => profile.filmClass === 'color_negative');
  const blackAndWhiteProfile = selectableProfiles.find((profile) => profile.filmClass === 'black_and_white_silver');
  const disabledReferenceProfile = profiles.find((profile) => !profile.isSelectable);
  const candidateProfiles = [
    selectedProfile,
    userProfile,
    measuredProfile,
    colorProfile,
    blackAndWhiteProfile,
    disabledReferenceProfile,
    ...selectableProfiles,
    ...profiles,
  ]
    .filter((profile): profile is NegativeLabRuntimeProfileBrowserRow => profile !== undefined)
    .filter(
      (profile, index, candidates) =>
        candidates.findIndex((candidate) => candidate.presetId === profile.presetId) === index,
    )
    .slice(0, 5);

  return negativeLabProfileComparisonRowsSchema.parse(
    candidateProfiles.map((profile) => {
      const deltas = PROFILE_DELTA_KEYS.map((key) => ({
        key,
        value: roundProfileDelta(profile.params[key] - currentParams[key]),
      }));
      const profileProvenanceHash = profileProvenanceHashById.get(profile.presetId);
      if (profileProvenanceHash === undefined) {
        throw new Error(`Missing Negative Lab profile provenance hash for ${profile.presetId}.`);
      }

      return {
        deltaSummary: deltas.map((delta) => `${delta.key}:${formatProfileDelta(delta.value)}`).join(', '),
        deltas,
        frameScope: {
          activeFrameLabel,
          queuedCount,
        },
        previewSwatch: buildNegativeLabProfilePreviewSwatch(currentParams, profile.params),
        profile,
        renderEvidence: buildNegativeLabProfileComparisonRenderEvidence({
          activeFrameLabel,
          currentParams,
          profile,
          profileProvenanceHash,
          queuedCount,
        }),
        selectedProfileSnapshot: buildNegativeLabSelectedProfileSnapshot(profile, profileProvenanceHash),
        mutationSafety: {
          browsingMutatesEditGraph: false,
          requiresAcceptedPlanForApply: true,
          selectableForRuntimeApply: profile.isSelectable,
        },
      };
    }),
  );
};

export const buildNegativeLabProfileBoundPlanIdentity = (
  dryRunSummaryJson: string,
  selectedProfile: NegativeLabSelectedProfileSnapshot,
) => {
  const acceptedDryRunPlanHash = `fnv1a32:${buildNegativeLabPlanHash(
    JSON.stringify({
      dryRunSummaryJson,
      selectedProfile,
    }),
  )}`;

  return {
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId: `negative_lab_batch_plan_${acceptedDryRunPlanHash.slice('fnv1a32:'.length)}`,
  };
};
