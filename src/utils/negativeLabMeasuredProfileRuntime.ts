import {
  NEGATIVE_LAB_IDENTITY_CROSSTALK_PROFILE,
  buildNegativeLabCrosstalkProfile,
} from './negativeLabCrosstalkProfile';
import { buildNegativeLabPlanHash } from './negativeLabPlanIdentity';
import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from './negativeLabPresetCatalog';
import negativeLabMeasuredProfileCatalogJson from '../data/negativeLabMeasuredProfileCatalog.json';
import {
  negativeLabSelectedProfileSnapshotAppServerSchema,
  type NegativeLabProfileProvenanceHash,
  type NegativeLabSelectedProfileSnapshotAppServer,
} from '../schemas/negativeLabAppServerSchemas';
import {
  type NegativeLabMeasuredProfile,
  type NegativeLabMeasuredProfileCatalog,
  type NegativeLabRuntimeProfileBrowserRow,
  type NegativeLabResolvedRuntimeProfile,
  type NegativeLabRuntimePresetId,
  parseNegativeLabMeasuredProfileCatalog,
  negativeLabRuntimeProfileBrowserRowSchema,
  negativeLabResolvedRuntimeProfileSchema,
} from '../schemas/negativeLabMeasuredProfileSchemas';
import {
  type NegativeLabBuiltInUiPresetCatalog,
  parseNegativeLabBuiltInUiPresetCatalog,
} from '../schemas/negativeLabPresetCatalogSchemas';

export interface NegativeLabRuntimeProfileCatalog {
  genericCatalog: NegativeLabBuiltInUiPresetCatalog;
  measuredCatalog: NegativeLabMeasuredProfileCatalog;
  userProfiles?: NegativeLabRuntimeProfileBrowserRow[];
}

export const NEGATIVE_LAB_EMPTY_MEASURED_PROFILE_CATALOG = {
  catalogId: 'negative_lab_measured_profile_catalog',
  catalogVersion: '2026-06-16',
  profiles: [],
  schemaVersion: 1,
} satisfies NegativeLabMeasuredProfileCatalog;

export const NEGATIVE_LAB_MEASURED_PROFILE_CATALOG = parseNegativeLabMeasuredProfileCatalog(
  negativeLabMeasuredProfileCatalogJson,
);

export const NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG = {
  genericCatalog: parseNegativeLabBuiltInUiPresetCatalog(NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG),
  measuredCatalog: NEGATIVE_LAB_MEASURED_PROFILE_CATALOG,
  userProfiles: [
    negativeLabRuntimeProfileBrowserRowSchema.parse({
      claimLevel: 'user_profile',
      claimPolicy: 'user_profile_no_stock_claim',
      crosstalkProfile: buildNegativeLabCrosstalkProfile({
        matrix: [
          [0.94, 0.04, 0.02],
          [0.03, 0.94, 0.03],
          [0.02, 0.05, 0.93],
        ],
        profileId: 'negative_lab.crosstalk.user.local_warm_proof.v1',
        provenance: 'user_owned',
        schemaVersion: 1,
        strength: 0.35,
      }),
      disabledReason: null,
      displayName: 'User profile: Local C-41 warm proof',
      doesNotProve: ['user_profile_unmeasured', 'no_stock_emulation_claim', 'no_colorimetric_match_claim'],
      evidenceFixtureCount: 0,
      filmClass: 'color_negative',
      isSelectable: true,
      measurementProfileId: 'negative_lab.user.c41.local_warm_proof.v1',
      params: {
        base_fog_sample: null,
        base_fog_strength: 1.04,
        blue_weight: 0.97,
        contrast: 1.03,
        exposure: 0.08,
        green_weight: 1,
        red_weight: 1.06,
      },
      presetId: 'negative_lab.user.c41.local_warm_proof.v1',
      processFamily: 'c41_color_negative',
      profileStatus: 'user_supplied',
      provenanceSummary:
        'User-owned local adjustment profile based on a generic C-41 starting point; unmeasured and no stock-emulation claim.',
      runtimeStatus: 'runtime_parameter_applied',
      sourceGenericPresetId: 'negative_lab.generic.c41.portrait.v1',
    }),
  ],
} satisfies NegativeLabRuntimeProfileCatalog;

const getMeasuredProfileDisabledReason = (profile: NegativeLabMeasuredProfile) => {
  if (profile.claimPolicy === 'named_stock_profile_requires_license_review') return 'license_review_required';
  if (profile.runtimeStatus !== 'runtime_parameter_applied') return 'catalog_only';
  return null;
};

export const buildNegativeLabRuntimeProfileBrowserRows = (
  catalog: NegativeLabRuntimeProfileCatalog = NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
): NegativeLabRuntimeProfileBrowserRow[] => {
  const genericRows = catalog.genericCatalog.presets.map((preset) =>
    negativeLabRuntimeProfileBrowserRowSchema.parse({
      claimLevel: preset.claimLevel,
      claimPolicy: preset.claimPolicy,
      crosstalkProfile: preset.filmClass === 'black_and_white_silver' ? null : NEGATIVE_LAB_IDENTITY_CROSSTALK_PROFILE,
      disabledReason: null,
      displayName: preset.displayName,
      doesNotProve: ['no_stock_emulation_claim', 'no_colorimetric_match_claim'],
      evidenceFixtureCount: 0,
      filmClass: preset.filmClass,
      isSelectable: true,
      measurementProfileId: preset.measurementProfileId,
      params: preset.params,
      presetId: preset.presetId,
      processFamily: preset.processFamily,
      profileStatus: preset.profileStatus,
      provenanceSummary: preset.provenanceSummary,
      runtimeStatus: preset.runtimeStatus,
      sourceGenericPresetId: null,
    }),
  );

  const measuredRows = catalog.measuredCatalog.profiles.map((profile) => {
    const disabledReason = getMeasuredProfileDisabledReason(profile);

    return negativeLabRuntimeProfileBrowserRowSchema.parse({
      claimLevel: profile.claimLevel,
      claimPolicy: profile.claimPolicy,
      crosstalkProfile:
        profile.filmClass === 'black_and_white_silver'
          ? null
          : (profile.crosstalkProfile ?? NEGATIVE_LAB_IDENTITY_CROSSTALK_PROFILE),
      disabledReason,
      displayName: profile.displayName,
      doesNotProve: profile.doesNotProve,
      evidenceFixtureCount: profile.evidenceFixtureIds.length,
      filmClass: profile.filmClass,
      isSelectable: disabledReason === null,
      measurementProfileId: profile.measurementProfileId,
      params: profile.params,
      presetId: profile.profileId,
      processFamily: profile.processFamily,
      profileStatus: profile.profileStatus,
      provenanceSummary:
        disabledReason === null
          ? `Fixture-measured process-family profile from ${profile.evidenceFixtureIds.length} approved fixture(s); no named-stock emulation claim.`
          : profile.runtimeLimitations.join(' '),
      runtimeStatus: profile.runtimeStatus,
      sourceGenericPresetId: profile.sourceGenericPresetId,
    });
  });

  return [...genericRows, ...measuredRows, ...(catalog.userProfiles ?? [])];
};

export const resolveNegativeLabRuntimeProfile = (
  presetId: NegativeLabRuntimePresetId,
  catalog: NegativeLabRuntimeProfileCatalog = NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
): NegativeLabResolvedRuntimeProfile => {
  const genericPreset = catalog.genericCatalog.presets.find((preset) => preset.presetId === presetId);
  if (genericPreset !== undefined) {
    return negativeLabResolvedRuntimeProfileSchema.parse({
      claimLevel: genericPreset.claimLevel,
      claimPolicy: genericPreset.claimPolicy,
      crosstalkProfile:
        genericPreset.filmClass === 'black_and_white_silver' ? null : NEGATIVE_LAB_IDENTITY_CROSSTALK_PROFILE,
      displayName: genericPreset.displayName,
      doesNotProve: ['no_stock_emulation_claim', 'no_colorimetric_match_claim'],
      evidenceDigest: null,
      evidenceFixtureIds: [],
      filmClass: genericPreset.filmClass,
      measurementProfileId: genericPreset.measurementProfileId,
      params: genericPreset.params,
      presetId: genericPreset.presetId,
      profileStatus: genericPreset.profileStatus,
      provenanceSummary: genericPreset.provenanceSummary,
      runtimeStatus: genericPreset.runtimeStatus,
      sourceGenericPresetId: null,
    });
  }

  const measuredProfile = catalog.measuredCatalog.profiles.find((profile) => profile.profileId === presetId);
  const userProfile = catalog.userProfiles?.find((profile) => profile.presetId === presetId);
  if (userProfile !== undefined) {
    return negativeLabResolvedRuntimeProfileSchema.parse({
      claimLevel: userProfile.claimLevel,
      claimPolicy: userProfile.claimPolicy,
      crosstalkProfile: userProfile.crosstalkProfile,
      displayName: userProfile.displayName,
      doesNotProve: userProfile.doesNotProve,
      evidenceDigest: null,
      evidenceFixtureIds: [],
      filmClass: userProfile.filmClass,
      measurementProfileId: userProfile.measurementProfileId,
      params: userProfile.params,
      presetId: userProfile.presetId,
      profileStatus: userProfile.profileStatus,
      provenanceSummary: userProfile.provenanceSummary,
      runtimeStatus: userProfile.runtimeStatus,
      sourceGenericPresetId: userProfile.sourceGenericPresetId,
    });
  }

  if (measuredProfile === undefined) {
    throw new Error(`Unknown Negative Lab runtime profile id: ${presetId}`);
  }

  if (measuredProfile.runtimeStatus !== 'runtime_parameter_applied') {
    throw new Error(`Negative Lab measured profile is not runtime-applied: ${presetId}`);
  }

  return negativeLabResolvedRuntimeProfileSchema.parse({
    claimLevel: measuredProfile.claimLevel,
    claimPolicy: measuredProfile.claimPolicy,
    crosstalkProfile:
      measuredProfile.filmClass === 'black_and_white_silver'
        ? null
        : (measuredProfile.crosstalkProfile ?? NEGATIVE_LAB_IDENTITY_CROSSTALK_PROFILE),
    displayName: measuredProfile.displayName,
    doesNotProve: measuredProfile.doesNotProve,
    evidenceDigest: measuredProfile.evidenceDigest,
    evidenceFixtureIds: measuredProfile.evidenceFixtureIds,
    filmClass: measuredProfile.filmClass,
    measurementProfileId: measuredProfile.measurementProfileId,
    params: measuredProfile.params,
    presetId: measuredProfile.profileId,
    profileStatus: measuredProfile.profileStatus,
    provenanceSummary: `Fixture-measured process-family profile from ${measuredProfile.evidenceFixtureIds.length} approved fixture(s); no named-stock emulation claim.`,
    runtimeStatus: measuredProfile.runtimeStatus,
    sourceGenericPresetId: measuredProfile.sourceGenericPresetId,
  });
};

export const buildNegativeLabRuntimeProfileProvenanceHash = (
  profile: NegativeLabResolvedRuntimeProfile,
): `fnv1a32:${string}` => {
  const { print_curve_algorithm, print_curve_output_tag, print_curve_v2, ...legacyCompatibleParams } = profile.params;
  const params =
    print_curve_algorithm === 'density_rgb_v1' &&
    print_curve_output_tag === 'preview_display' &&
    print_curve_v2 === null
      ? legacyCompatibleParams
      : profile.params;
  const provenancePayload = {
    claimLevel: profile.claimLevel,
    claimPolicy: profile.claimPolicy,
    crosstalkProfile: profile.crosstalkProfile,
    displayName: profile.displayName,
    doesNotProve: profile.doesNotProve,
    evidenceDigest: profile.evidenceDigest,
    evidenceFixtureIds: profile.evidenceFixtureIds,
    filmClass: profile.filmClass,
    measurementProfileId: profile.measurementProfileId,
    params,
    presetId: profile.presetId,
    profileStatus: profile.profileStatus,
    runtimeStatus: profile.runtimeStatus,
    sourceGenericPresetId: profile.sourceGenericPresetId,
  };

  return `fnv1a32:${buildNegativeLabPlanHash(JSON.stringify(provenancePayload))}`;
};

export const buildNegativeLabRuntimeSelectedProfileSnapshot = (
  profile: NegativeLabResolvedRuntimeProfile,
  profileProvenanceHash: NegativeLabProfileProvenanceHash = buildNegativeLabRuntimeProfileProvenanceHash(profile),
): NegativeLabSelectedProfileSnapshotAppServer =>
  negativeLabSelectedProfileSnapshotAppServerSchema.parse({
    claimLevel: profile.claimLevel,
    claimPolicy: profile.claimPolicy,
    crosstalkProfile: profile.crosstalkProfile,
    displayName: profile.displayName,
    doesNotProve: profile.doesNotProve,
    evidenceFixtureCount: profile.evidenceFixtureIds.length,
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
