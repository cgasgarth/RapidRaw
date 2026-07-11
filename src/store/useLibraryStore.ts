import { create } from 'zustand';
import type { FolderTree } from '../components/panel/FolderTree';
import type { ColumnWidths } from '../components/panel/MainLibrary';
import {
  type AlbumItem,
  type FilterCriteria,
  type ImageFile,
  RawStatus,
  type SortCriteria,
  SortDirection,
} from '../components/ui/AppProperties';
import { type LibraryImagePatch, libraryEntityRepository } from '../library/LibraryEntityRepository';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../utils/adjustments';

export interface SearchCriteria {
  tags: string[];
  text: string;
  mode: 'AND' | 'OR';
}

interface LibraryState {
  // Paths & Trees
  rootPaths: string[];
  currentFolderPath: string | null;
  expandedFolders: Set<string>;
  folderTrees: FolderTree[];
  pinnedFolderTrees: FolderTree[];

  // Albums
  albumTree: AlbumItem[];
  activeAlbumId: string | null;
  expandedAlbumGroups: Set<string>;

  // Images & Selection
  imageList: Array<ImageFile>;
  imageRatings: Record<string, number>;
  catalogSessionId: number | null;
  catalogRevision: number | null;
  catalogOrderedImageIds: string[];
  multiSelectedPaths: Array<string>;
  selectionAnchorPath: string | null;
  libraryActivePath: string | null;
  libraryActiveAdjustments: Adjustments;

  // Sorting & Filtering
  sortCriteria: SortCriteria;
  filterCriteria: FilterCriteria;
  searchCriteria: SearchCriteria;

  // UI State specific to the Library View
  isTreeLoading: boolean;
  isViewLoading: boolean;
  libraryScrollTop: number;
  listColumnWidths: ColumnWidths;

  // Actions
  setLibrary: (updater: Partial<LibraryState> | ((state: LibraryState) => Partial<LibraryState>)) => void;
  setListColumnWidths: (widths: ColumnWidths) => void;
  clearSelection: () => void;
  setFilterCriteria: (criteria: Partial<FilterCriteria> | ((prev: FilterCriteria) => FilterCriteria)) => void;
  setSearchCriteria: (criteria: Partial<SearchCriteria> | ((prev: SearchCriteria) => SearchCriteria)) => void;
  setSortCriteria: (criteria: Partial<SortCriteria> | ((prev: SortCriteria) => SortCriteria)) => void;
  patchLibraryImages: (patches: readonly LibraryImagePatch[]) => void;
  replaceCatalogCollection: (sessionId: number, revision: number, images: readonly ImageFile[]) => void;
  appendCatalogPage: (sessionId: number, revision: number, images: readonly ImageFile[]) => boolean;
  applyCatalogDelta: (revision: number, upserted: readonly ImageFile[], removedPaths: readonly string[]) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  rootPaths: [],
  currentFolderPath: null,
  expandedFolders: new Set<string>(),
  folderTrees: [],
  pinnedFolderTrees: [],

  albumTree: [],
  activeAlbumId: null,
  expandedAlbumGroups: new Set<string>(),

  imageList: [],
  imageRatings: {},
  catalogSessionId: null,
  catalogRevision: null,
  catalogOrderedImageIds: [],
  multiSelectedPaths: [],
  selectionAnchorPath: null,
  libraryActivePath: null,
  libraryActiveAdjustments: INITIAL_ADJUSTMENTS,

  sortCriteria: { key: 'name', order: SortDirection.Ascending },
  filterCriteria: { colors: [], rating: 0, rawStatus: RawStatus.All },
  searchCriteria: { tags: [], text: '', mode: 'OR' },

  isTreeLoading: false,
  isViewLoading: false,
  libraryScrollTop: 0,
  listColumnWidths: {
    thumbnail: 4,
    name: 20,
    date: 15,
    rating: 8,
    color: 8,
    shutter: 10,
    aperture: 10,
    iso: 10,
    focal: 15,
  },

  setLibrary: (updater) => {
    set((state) => (typeof updater === 'function' ? updater(state) : updater));
  },

  setListColumnWidths: (listColumnWidths) => {
    set({ listColumnWidths });
  },

  clearSelection: () => {
    set({ multiSelectedPaths: [], libraryActivePath: null });
  },

  setFilterCriteria: (criteria) => {
    set((state) => ({
      filterCriteria:
        typeof criteria === 'function' ? criteria(state.filterCriteria) : { ...state.filterCriteria, ...criteria },
    }));
  },

  setSearchCriteria: (criteria) => {
    set((state) => ({
      searchCriteria:
        typeof criteria === 'function' ? criteria(state.searchCriteria) : { ...state.searchCriteria, ...criteria },
    }));
  },

  setSortCriteria: (criteria) => {
    set((state) => ({
      sortCriteria:
        typeof criteria === 'function' ? criteria(state.sortCriteria) : { ...state.sortCriteria, ...criteria },
    }));
  },
  patchLibraryImages: (patches) => libraryEntityRepository.patchMany(patches),
  replaceCatalogCollection: (catalogSessionId, catalogRevision, images) => {
    libraryEntityRepository.replaceAll(images);
    set({
      catalogSessionId,
      catalogRevision,
      catalogOrderedImageIds: images.map((image) => image.path),
      imageList: [...images],
    });
  },
  appendCatalogPage: (sessionId, revision, images) => {
    let accepted = false;
    set((state) => {
      if (state.catalogSessionId !== sessionId || state.catalogRevision !== revision) return {};
      accepted = true;
      libraryEntityRepository.upsertMany(images);
      return {
        catalogOrderedImageIds: [...state.catalogOrderedImageIds, ...images.map((image) => image.path)],
        imageList: [...state.imageList, ...images],
      };
    });
    return accepted;
  },
  applyCatalogDelta: (catalogRevision, upserted, removedPaths) => {
    const removed = new Set(removedPaths);
    const refreshed = new Set(upserted.map((image) => image.path));
    libraryEntityRepository.removeMany(removedPaths);
    libraryEntityRepository.upsertMany(upserted);
    set((state) => ({
      catalogRevision,
      catalogOrderedImageIds: [
        ...state.catalogOrderedImageIds.filter((path) => !removed.has(path) && !refreshed.has(path)),
        ...upserted.map((image) => image.path),
      ],
      imageList: [
        ...state.imageList.filter((image) => !removed.has(image.path) && !refreshed.has(image.path)),
        ...upserted,
      ],
    }));
  },
}));

// Existing loaders seed normalized snapshots until their collection/order migration lands.
useLibraryStore.subscribe((state, previous) => {
  if (
    state.catalogSessionId === null &&
    (state.imageList !== previous.imageList || state.imageRatings !== previous.imageRatings)
  ) {
    libraryEntityRepository.replaceAll(state.imageList, state.imageRatings);
  }
});
