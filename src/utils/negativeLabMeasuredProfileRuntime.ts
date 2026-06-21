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

  return [...genericRows, ...measuredRows];
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
      displayName: genericPreset.displayName,
      doesNotProve: ['no_stock_emulation_claim', 'no_colorimetric_match_claim'],
      evidenceDigest: null,
      evidenceFixtureIds: [],
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
  if (measuredProfile === undefined) {
    throw new Error(`Unknown Negative Lab runtime profile id: ${presetId}`);
  }

  if (measuredProfile.runtimeStatus !== 'runtime_parameter_applied') {
    throw new Error(`Negative Lab measured profile is not runtime-applied: ${presetId}`);
  }

  return negativeLabResolvedRuntimeProfileSchema.parse({
    claimLevel: measuredProfile.claimLevel,
    claimPolicy: measuredProfile.claimPolicy,
    displayName: measuredProfile.displayName,
    doesNotProve: measuredProfile.doesNotProve,
    evidenceDigest: measuredProfile.evidenceDigest,
    evidenceFixtureIds: measuredProfile.evidenceFixtureIds,
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
  const provenancePayload = {
    claimLevel: profile.claimLevel,
    claimPolicy: profile.claimPolicy,
    displayName: profile.displayName,
    doesNotProve: profile.doesNotProve,
    evidenceDigest: profile.evidenceDigest,
    evidenceFixtureIds: profile.evidenceFixtureIds,
    measurementProfileId: profile.measurementProfileId,
    params: profile.params,
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
    displayName: profile.displayName,
    doesNotProve: profile.doesNotProve,
    evidenceFixtureCount: profile.evidenceFixtureIds.length,
    measurementProfileId: profile.measurementProfileId,
    params: profile.params,
    presetId: profile.presetId,
    profileProvenanceHash,
    profileStatus: profile.profileStatus,
    provenanceSummary: profile.provenanceSummary,
    runtimeStatus: profile.runtimeStatus,
    sourceGenericPresetId: profile.sourceGenericPresetId,
  });
