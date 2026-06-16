import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from './negativeLabPresetCatalog';

import type {
  NegativeLabMeasuredProfile,
  NegativeLabMeasuredProfileCatalog,
  NegativeLabRuntimeProfileBrowserRow,
} from '../schemas/negativeLabMeasuredProfileSchemas';
import type { NegativeLabBuiltInUiPresetCatalog } from '../schemas/negativeLabPresetCatalogSchemas';

interface NegativeLabProfileBrowserCatalog {
  genericCatalog: NegativeLabBuiltInUiPresetCatalog;
  measuredCatalog: NegativeLabMeasuredProfileCatalog;
}

const EMPTY_MEASURED_PROFILE_CATALOG = {
  catalogId: 'negative_lab_measured_profile_catalog',
  catalogVersion: '2026-06-16',
  profiles: [],
  schemaVersion: 1,
} satisfies NegativeLabMeasuredProfileCatalog;

const getMeasuredProfileDisabledReason = (profile: NegativeLabMeasuredProfile) => {
  if (profile.claimPolicy === 'named_stock_profile_requires_license_review') return 'license_review_required';
  if (profile.runtimeStatus !== 'runtime_parameter_applied') return 'catalog_only';
  return null;
};

export const buildNegativeLabProfileBrowserRows = (
  catalog: NegativeLabProfileBrowserCatalog = {
    genericCatalog: NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG,
    measuredCatalog: EMPTY_MEASURED_PROFILE_CATALOG,
  },
): NegativeLabRuntimeProfileBrowserRow[] => {
  const genericRows = catalog.genericCatalog.presets.map(
    (preset): NegativeLabRuntimeProfileBrowserRow => ({
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

  const measuredRows = catalog.measuredCatalog.profiles.map((profile): NegativeLabRuntimeProfileBrowserRow => {
    const disabledReason = getMeasuredProfileDisabledReason(profile);

    return {
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
    };
  });

  return [...genericRows, ...measuredRows];
};
