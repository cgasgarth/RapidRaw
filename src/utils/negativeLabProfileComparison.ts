import type { NegativeLabRuntimeProfileBrowserRow } from '../schemas/negativeLabMeasuredProfileSchemas';
import type { NegativeLabPresetParams } from '../schemas/negativeLabPresetCatalogSchemas';
import {
  type NegativeLabProfileComparisonRow,
  type NegativeLabSelectedProfileSnapshot,
  negativeLabProfileComparisonRowsSchema,
  negativeLabSelectedProfileSnapshotSchema,
} from '../schemas/negativeLabProfileComparisonSchemas';
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
const profileParamsToCssRgb = (params: NegativeLabPresetParams): `rgb(${number} ${number} ${number})` => {
  const densityLift = params.base_fog_strength * 18;
  const exposureLift = params.exposure * 22;
  const contrastLift = (params.contrast - 1) * 28;
  const endpointLift = (params.black_point + (1 - params.white_point)) * 36;

  return `rgb(${clampRgbChannel(118 + densityLift + exposureLift + endpointLift + contrastLift + params.red_weight * 22)} ${clampRgbChannel(116 + densityLift + exposureLift + endpointLift + params.green_weight * 18)} ${clampRgbChannel(112 + densityLift + exposureLift + endpointLift - contrastLift + params.blue_weight * 24)})`;
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
  const candidateProfiles = [
    selectedProfile,
    userProfile,
    measuredProfile,
    colorProfile,
    blackAndWhiteProfile,
    ...selectableProfiles,
  ]
    .filter((profile): profile is NegativeLabRuntimeProfileBrowserRow => profile !== undefined)
    .filter(
      (profile, index, candidates) =>
        candidates.findIndex((candidate) => candidate.presetId === profile.presetId) === index,
    )
    .slice(0, 4);

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
        selectedProfileSnapshot: buildNegativeLabSelectedProfileSnapshot(profile, profileProvenanceHash),
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
