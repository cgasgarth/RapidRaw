import { buildNegativeLabPlanHash } from './negativeLabPlanIdentity';
import {
  negativeLabProfileComparisonRowsSchema,
  negativeLabSelectedProfileSnapshotSchema,
  type NegativeLabProfileComparisonRow,
  type NegativeLabSelectedProfileSnapshot,
} from '../schemas/negativeLabProfileComparisonSchemas';

import type { NegativeLabRuntimeProfileBrowserRow } from '../schemas/negativeLabMeasuredProfileSchemas';
import type { NegativeLabPresetParams } from '../schemas/negativeLabPresetCatalogSchemas';

const PROFILE_DELTA_KEYS = [
  'exposure',
  'contrast',
  'base_fog_strength',
  'red_weight',
  'green_weight',
  'blue_weight',
] as const satisfies Array<keyof NegativeLabPresetParams>;

const roundProfileDelta = (value: number) => Math.round(value * 100) / 100;
const formatProfileDelta = (value: number) => (value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2));

export const buildNegativeLabBrowserProfileProvenanceHash = (
  profile: NegativeLabRuntimeProfileBrowserRow,
): `fnv1a32:${string}` =>
  `fnv1a32:${buildNegativeLabPlanHash(
    JSON.stringify({
      claimLevel: profile.claimLevel,
      claimPolicy: profile.claimPolicy,
      displayName: profile.displayName,
      doesNotProve: profile.doesNotProve,
      evidenceFixtureCount: profile.evidenceFixtureCount,
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
    displayName: profile.displayName,
    doesNotProve: profile.doesNotProve,
    evidenceFixtureCount: profile.evidenceFixtureCount,
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
  const measuredProfile = selectableProfiles.find((profile) => profile.profileStatus === 'fixture_measured');
  const colorProfile = selectableProfiles.find((profile) => profile.filmClass === 'color_negative');
  const blackAndWhiteProfile = selectableProfiles.find((profile) => profile.filmClass === 'black_and_white_silver');
  const candidateProfiles = [
    selectedProfile,
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
