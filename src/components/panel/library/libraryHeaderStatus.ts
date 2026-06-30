import { EditedStatus, LibraryViewMode, RawStatus, SortDirection } from '../../ui/AppProperties';

import type { SearchCriteria } from '../../../store/useLibraryStore';
import type { FilterCriteria, SortCriteria } from '../../ui/AppProperties';
import type { TFunction } from 'i18next';

export interface LibraryHeaderStatusItem {
  label: string;
  value: string;
}

export interface LibraryHeaderStatusOptions {
  filterCriteria: FilterCriteria;
  libraryViewMode: LibraryViewMode;
  searchCriteria: SearchCriteria;
  sortCriteria: SortCriteria;
  t: TFunction;
  translatedSortOptions: Array<{ key: string; label: string }>;
}

export function buildLibraryHeaderStatusItems({
  filterCriteria,
  libraryViewMode,
  searchCriteria,
  sortCriteria,
  t,
  translatedSortOptions,
}: LibraryHeaderStatusOptions): LibraryHeaderStatusItem[] {
  const activeSearchTokenCount = searchCriteria.tags.length + (searchCriteria.text.trim().length > 0 ? 1 : 0);
  const activeFilterCount =
    (filterCriteria.rating !== 0 ? 1 : 0) +
    (filterCriteria.rawStatus !== RawStatus.All ? 1 : 0) +
    ((filterCriteria.editedStatus || EditedStatus.All) !== EditedStatus.All ? 1 : 0) +
    (filterCriteria.colors.length > 0 ? 1 : 0);
  const sortLabel =
    translatedSortOptions.find((option) => option.key === sortCriteria.key)?.label ?? t('library.sort.fileName');
  const sortDirectionLabel =
    sortCriteria.order === SortDirection.Ascending
      ? t('library.header.status.ascending')
      : t('library.header.status.descending');
  const viewModeLabel =
    libraryViewMode === LibraryViewMode.Recursive
      ? t('library.header.viewOptions.recursive')
      : t('library.header.viewOptions.currentFolder');

  return [
    {
      label: t('library.header.status.searchLabel'),
      value:
        activeSearchTokenCount > 0
          ? t('library.header.status.searchActive', { count: activeSearchTokenCount })
          : t('library.header.status.searchReady'),
    },
    {
      label: t('library.header.status.filterLabel'),
      value:
        activeFilterCount > 0
          ? t('library.header.status.filterActive', { count: activeFilterCount })
          : t('library.header.status.filterReady'),
    },
    {
      label: t('library.header.status.sortLabel'),
      value: t('library.header.status.sortValue', { direction: sortDirectionLabel, sort: sortLabel }),
    },
    {
      label: t('library.header.status.viewLabel'),
      value: viewModeLabel,
    },
  ];
}
