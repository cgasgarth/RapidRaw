import { useMemo } from 'react';

import { buildNegativeLabProfileBrowserRows } from '../utils/negativeLabProfileBrowserRows';
import { listNegativeLabStockMetadataReferencesForPreset } from '../utils/negativeLabStockMetadataCatalog';

import type { NegativeLabRuntimeProfileBrowserRow } from '../schemas/negativeLabMeasuredProfileSchemas';

export type NegativeLabProfileFilter = 'all' | 'black_and_white_silver' | 'color_negative' | 'measured';
export type NegativeLabProfileSort = 'catalog' | 'evidence_desc' | 'name_asc' | 'runtime_applied';
export type NegativeLabProfileFilterLabelKey =
  | 'modals.negativeConversion.profileFilterAll'
  | 'modals.negativeConversion.profileFilterBlackAndWhite'
  | 'modals.negativeConversion.profileFilterColorNegative'
  | 'modals.negativeConversion.profileFilterMeasured';
export type NegativeLabProfileSortLabelKey =
  | 'modals.negativeConversion.profileSortCatalog'
  | 'modals.negativeConversion.profileSortEvidence'
  | 'modals.negativeConversion.profileSortName'
  | 'modals.negativeConversion.profileSortRuntime';

export const NEGATIVE_LAB_PROFILE_BROWSER_ROWS = buildNegativeLabProfileBrowserRows();
export const NEGATIVE_LAB_PROFILE_BROWSER_ROW_BY_ID = new Map(
  NEGATIVE_LAB_PROFILE_BROWSER_ROWS.map((row) => [row.presetId, row]),
);
export const NEGATIVE_LAB_PROFILE_FILTERS = [
  { id: 'all', labelKey: 'modals.negativeConversion.profileFilterAll' },
  { id: 'color_negative', labelKey: 'modals.negativeConversion.profileFilterColorNegative' },
  { id: 'black_and_white_silver', labelKey: 'modals.negativeConversion.profileFilterBlackAndWhite' },
  { id: 'measured', labelKey: 'modals.negativeConversion.profileFilterMeasured' },
] satisfies Array<{ id: NegativeLabProfileFilter; labelKey: NegativeLabProfileFilterLabelKey }>;
export const NEGATIVE_LAB_PROFILE_FILTER_TEST_IDS = {
  all: 'negative-lab-profile-filter-all',
  black_and_white_silver: 'negative-lab-profile-filter-black_and_white_silver',
  color_negative: 'negative-lab-profile-filter-color_negative',
  measured: 'negative-lab-profile-filter-measured',
} satisfies Record<NegativeLabProfileFilter, string>;
export const NEGATIVE_LAB_PROFILE_SORTS = [
  { id: 'catalog', labelKey: 'modals.negativeConversion.profileSortCatalog' },
  { id: 'name_asc', labelKey: 'modals.negativeConversion.profileSortName' },
  { id: 'evidence_desc', labelKey: 'modals.negativeConversion.profileSortEvidence' },
  { id: 'runtime_applied', labelKey: 'modals.negativeConversion.profileSortRuntime' },
] satisfies Array<{ id: NegativeLabProfileSort; labelKey: NegativeLabProfileSortLabelKey }>;
export const NEGATIVE_LAB_PROFILE_SORT_TEST_IDS = {
  catalog: 'negative-lab-profile-sort-catalog',
  evidence_desc: 'negative-lab-profile-sort-evidence_desc',
  name_asc: 'negative-lab-profile-sort-name_asc',
  runtime_applied: 'negative-lab-profile-sort-runtime_applied',
} satisfies Record<NegativeLabProfileSort, string>;

export const isNegativeLabProfileSort = (value: string): value is NegativeLabProfileSort =>
  NEGATIVE_LAB_PROFILE_SORTS.some((sort) => sort.id === value);

const getNegativeLabProfileSearchText = (profile: NegativeLabRuntimeProfileBrowserRow) =>
  [
    profile.claimLevel,
    profile.claimPolicy,
    profile.displayName,
    profile.filmClass,
    profile.measurementProfileId ?? '',
    profile.presetId,
    profile.processFamily,
    profile.profileStatus,
    profile.provenanceSummary,
    profile.runtimeStatus,
    profile.sourceGenericPresetId ?? '',
    String(profile.evidenceFixtureCount),
    String(profile.params.base_fog_strength),
    String(profile.params.black_point),
    String(profile.params.blue_weight),
    String(profile.params.contrast),
    String(profile.params.exposure),
    String(profile.params.green_weight),
    String(profile.params.red_weight),
    String(profile.params.white_point),
    ...profile.doesNotProve,
  ]
    .join(' ')
    .toLocaleLowerCase('en-US');

const matchesNegativeLabProfileFilter = (
  profile: NegativeLabRuntimeProfileBrowserRow,
  filter: NegativeLabProfileFilter,
) => {
  if (filter === 'all') return true;
  if (filter === 'measured') return profile.profileStatus === 'fixture_measured';
  return profile.filmClass === filter;
};

const compareNegativeLabProfileNames = (
  left: NegativeLabRuntimeProfileBrowserRow,
  right: NegativeLabRuntimeProfileBrowserRow,
) => left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });

const sortNegativeLabProfiles = (
  profiles: Array<NegativeLabRuntimeProfileBrowserRow>,
  sortMode: NegativeLabProfileSort,
) => {
  if (sortMode === 'name_asc') {
    return profiles.toSorted(compareNegativeLabProfileNames);
  }

  if (sortMode === 'evidence_desc') {
    return profiles.toSorted(
      (left, right) =>
        right.evidenceFixtureCount - left.evidenceFixtureCount || compareNegativeLabProfileNames(left, right),
    );
  }

  if (sortMode === 'runtime_applied') {
    return profiles.toSorted((left, right) => {
      const leftScore = left.runtimeStatus === 'runtime_parameter_applied' ? 1 : 0;
      const rightScore = right.runtimeStatus === 'runtime_parameter_applied' ? 1 : 0;
      return rightScore - leftScore || compareNegativeLabProfileNames(left, right);
    });
  }

  return profiles;
};

interface UseNegativeLabProfileBrowserParams {
  profileFilter: NegativeLabProfileFilter;
  profileSearchQuery: string;
  profileSort: NegativeLabProfileSort;
  selectedPresetId: string;
}

export const useNegativeLabProfileBrowser = ({
  profileFilter,
  profileSearchQuery,
  profileSort,
  selectedPresetId,
}: UseNegativeLabProfileBrowserParams) => {
  const selectedProfile = useMemo(
    () => NEGATIVE_LAB_PROFILE_BROWSER_ROWS.find((profile) => profile.presetId === selectedPresetId) ?? null,
    [selectedPresetId],
  );
  const normalizedProfileSearchQuery = profileSearchQuery.trim().toLocaleLowerCase('en-US');
  const profileFilterCounts = useMemo(
    () =>
      NEGATIVE_LAB_PROFILE_FILTERS.reduce<Record<NegativeLabProfileFilter, number>>(
        (counts, filter) => ({
          ...counts,
          [filter.id]: NEGATIVE_LAB_PROFILE_BROWSER_ROWS.filter((profile) =>
            matchesNegativeLabProfileFilter(profile, filter.id),
          ).length,
        }),
        {
          all: 0,
          black_and_white_silver: 0,
          color_negative: 0,
          measured: 0,
        },
      ),
    [],
  );
  const visibleProfileRows = useMemo(() => {
    const filteredProfiles = NEGATIVE_LAB_PROFILE_BROWSER_ROWS.filter((profile) => {
      if (!matchesNegativeLabProfileFilter(profile, profileFilter)) {
        return false;
      }

      if (normalizedProfileSearchQuery.length === 0) {
        return true;
      }

      return getNegativeLabProfileSearchText(profile).includes(normalizedProfileSearchQuery);
    });

    return sortNegativeLabProfiles(filteredProfiles, profileSort);
  }, [normalizedProfileSearchQuery, profileFilter, profileSort]);
  const selectedProfileStockReferences = useMemo(() => {
    if (selectedProfile === null) return [];
    return listNegativeLabStockMetadataReferencesForPreset(
      selectedProfile.sourceGenericPresetId ?? selectedProfile.presetId,
    );
  }, [selectedProfile]);

  return {
    profileFilterCounts,
    selectedProfile,
    selectedProfileStockReferences,
    visibleProfileRows,
  };
};
