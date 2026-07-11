import type { FilterCriteria, SortCriteria } from '../components/ui/AppProperties';
import type { SearchCriteria } from '../store/useLibraryStore';
import { compileLibraryQuery } from './compileLibraryQuery';
import type { LibrarySearchProjection } from './LibrarySearchProjection';

export interface SerializedCompiledLibraryQuery {
  filterCriteria: FilterCriteria;
  searchCriteria: SearchCriteria;
  sortCriteria: SortCriteria;
}

export function queryLibraryProjections(
  projections: readonly LibrarySearchProjection[],
  criteria: SerializedCompiledLibraryQuery,
): string[] {
  const query = compileLibraryQuery(criteria.searchCriteria, criteria.filterCriteria, criteria.sortCriteria);
  let rawPairKeys: Set<string> | null = null;
  if (query.rawOverNonRaw) {
    rawPairKeys = new Set<string>();
    for (const projection of projections) if (projection.isRaw) rawPairKeys.add(projection.rawPairKey);
  }
  const matched = [];
  for (const projection of projections) {
    if (rawPairKeys?.has(projection.rawPairKey) && projection.isNonRaw) continue;
    if (query.filter(projection)) matched.push(projection);
  }
  matched.sort(query.compare);
  return matched.map((projection) => projection.path);
}
