import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from './negativeLabPresetCatalog';
import {
  type NegativeLabMeasuredProfileCatalog,
  type NegativeLabResolvedRuntimeProfile,
  type NegativeLabRuntimePresetId,
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

export const NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG = {
  genericCatalog: parseNegativeLabBuiltInUiPresetCatalog(NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG),
  measuredCatalog: NEGATIVE_LAB_EMPTY_MEASURED_PROFILE_CATALOG,
} satisfies NegativeLabRuntimeProfileCatalog;

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
