import { useMemo } from 'react';

import type { FilterCriteria, ImageFile, SortCriteria, SupportedTypes } from '../../components/ui/AppProperties';
import { ADVANCED_QUERY_REGEX, compileLibraryQuery } from '../../library/compileLibraryQuery';
import { LibraryProjectionCache } from '../../library/LibraryProjectionCache';
import {
  normalizeSupportedTypes,
  parseAperture,
  parseFocalLength,
  parseShutter,
} from '../../library/LibrarySearchProjection';
import { type SearchCriteria, useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';

export { ADVANCED_QUERY_REGEX, parseAperture, parseFocalLength, parseShutter };

interface SortedLibraryState {
  filterCriteria: FilterCriteria;
  imageList: ImageFile[];
  imageRatings: Record<string, number>;
  searchCriteria: SearchCriteria;
  sortCriteria: SortCriteria;
}

interface SortedLibrarySettingsState {
  supportedTypes: SupportedTypes | null;
}

export const libraryProjectionCache = new LibraryProjectionCache();

export function computeSortedLibrary(
  libraryState: SortedLibraryState,
  settingsState: SortedLibrarySettingsState,
  cache: LibraryProjectionCache = libraryProjectionCache,
): ImageFile[] {
  const supportedTypes = normalizeSupportedTypes(settingsState.supportedTypes);
  const entities = new Map<string, ImageFile>();
  const retainedPaths = new Set<string>();
  const projections = libraryState.imageList.map((image) => {
    entities.set(image.path, image);
    retainedPaths.add(image.path);
    return cache.getOrBuild(image, libraryState.imageRatings[image.path] || 0, supportedTypes);
  });
  cache.retainOnly(retainedPaths);

  const query = compileLibraryQuery(
    libraryState.searchCriteria,
    libraryState.filterCriteria,
    libraryState.sortCriteria,
  );
  let rawPairKeys: Set<string> | null = null;
  if (query.rawOverNonRaw) {
    rawPairKeys = new Set<string>();
    for (const projection of projections) if (projection.isRaw) rawPairKeys.add(projection.rawPairKey);
  }

  const result = [];
  for (const projection of projections) {
    // Virtual copies retain distinct entity paths but share their physical RAW-pair identity.
    if (rawPairKeys?.has(projection.rawPairKey) && projection.isNonRaw) continue;
    if (query.filter(projection)) result.push(projection);
  }
  result.sort(query.compare);
  return result.map((projection) => entities.get(projection.path) as ImageFile);
}

export function useSortedLibrary() {
  const imageList = useLibraryStore((state) => state.imageList);
  const imageRatings = useLibraryStore((state) => state.imageRatings);
  const filterCriteria = useLibraryStore((state) => state.filterCriteria);
  const searchCriteria = useLibraryStore((state) => state.searchCriteria);
  const sortCriteria = useLibraryStore((state) => state.sortCriteria);
  const supportedTypes = useSettingsStore((state) => state.supportedTypes);

  return useMemo(
    () =>
      computeSortedLibrary(
        { imageList, imageRatings, filterCriteria, searchCriteria, sortCriteria },
        { supportedTypes },
      ),
    [imageList, sortCriteria, imageRatings, filterCriteria, supportedTypes, searchCriteria],
  );
}
