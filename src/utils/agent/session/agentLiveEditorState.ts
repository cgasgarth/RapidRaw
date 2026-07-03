import { createRawEngineLocalAppServerBridge } from '../../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  type ProjectLibrarySnapshotV1,
  projectLibrarySnapshotV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas';
import type { FolderTree } from '../../../components/panel/FolderTree';
import type { AlbumItem, ImageFile, RawStatus, SortDirection } from '../../../components/ui/AppProperties';
import { useEditorStore } from '../../../store/useEditorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import {
  agentCurrentImagePreviewLoopApplyReviewRequestSchema,
  applyAgentCurrentImagePreviewLoopReviewedEdit,
  runAgentCurrentImagePreviewLoop,
} from '../context/agentCurrentImagePreviewLoop';

const mapFolder = (folder: FolderTree): ProjectLibrarySnapshotV1['folders'][number] => ({
  children: folder.children.map(mapFolder),
  hasSubdirs: folder.hasSubdirs ?? folder.children.length > 0,
  imageCount: folder.imageCount ?? 0,
  isDir: true,
  name: folder.name,
  path: folder.path,
});

const mapAlbum = (album: AlbumItem): ProjectLibrarySnapshotV1['albums'][number] => {
  if (album.type === 'album') {
    return {
      ...(album.icon === undefined ? {} : { icon: album.icon }),
      id: album.id,
      images: album.images,
      name: album.name,
      type: 'album',
    };
  }

  return {
    ...(album.icon === undefined ? {} : { icon: album.icon }),
    children: album.children.map(mapAlbum),
    id: album.id,
    name: album.name,
    type: 'group',
  };
};

const mapImage = (image: ImageFile): ProjectLibrarySnapshotV1['imageList'][number] => ({
  exif: image.exif,
  isEdited: image.is_edited,
  isVirtualCopy: image.is_virtual_copy,
  modified: image.modified,
  path: image.path,
  rating: image.rating,
  tags: image.tags,
});

const normalizeRawStatus = (rawStatus: RawStatus): ProjectLibrarySnapshotV1['filterCriteria']['rawStatus'] => rawStatus;
const normalizeSortOrder = (order: SortDirection): ProjectLibrarySnapshotV1['sortCriteria']['order'] => order;

export const buildLiveEditorProjectLibrarySnapshot = (): ProjectLibrarySnapshotV1 => {
  const editorState = useEditorStore.getState();
  const libraryState = useLibraryStore.getState();
  const activePath = editorState.selectedImage?.path ?? libraryState.libraryActivePath;
  const imageList = libraryState.imageList.map(mapImage);

  if (
    editorState.selectedImage !== null &&
    !imageList.some((image) => image.path === editorState.selectedImage?.path)
  ) {
    imageList.push({
      exif: editorState.selectedImage.exif,
      isEdited: true,
      isVirtualCopy: editorState.selectedImage.path.includes('?vc='),
      modified: 0,
      path: editorState.selectedImage.path,
      rating: libraryState.imageRatings[editorState.selectedImage.path] ?? 0,
      tags: null,
    });
  }

  return projectLibrarySnapshotV1Schema.parse({
    activeAlbumId: libraryState.activeAlbumId,
    albums: libraryState.albumTree.map(mapAlbum),
    currentFolderPath: libraryState.currentFolderPath,
    filterCriteria: {
      colors: libraryState.filterCriteria.colors,
      ...(libraryState.filterCriteria.editedStatus === undefined
        ? {}
        : { editedStatus: libraryState.filterCriteria.editedStatus }),
      rating: libraryState.filterCriteria.rating,
      rawStatus: normalizeRawStatus(libraryState.filterCriteria.rawStatus),
    },
    folders: libraryState.folderTrees.map(mapFolder),
    imageList,
    libraryActivePath: activePath,
    multiSelectedPaths:
      libraryState.multiSelectedPaths.length > 0
        ? libraryState.multiSelectedPaths
        : activePath === null
          ? []
          : [activePath],
    pinnedFolders: libraryState.pinnedFolderTrees.map(mapFolder),
    rootPaths: libraryState.rootPaths,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sortCriteria: {
      ...(libraryState.sortCriteria.label === undefined ? {} : { label: libraryState.sortCriteria.label }),
      key: libraryState.sortCriteria.key,
      order: normalizeSortOrder(libraryState.sortCriteria.order),
    },
  });
};

export const createLiveEditorAppServerBridge = () =>
  createRawEngineLocalAppServerBridge({
    getProjectLibrarySnapshot: buildLiveEditorProjectLibrarySnapshot,
    runSelectedImagePreviewLoop: (command) => {
      const { commandType: _commandType, ...request } = command;
      return runAgentCurrentImagePreviewLoop(request);
    },
    runSelectedImagePreviewLoopApplyReview: (command) => {
      const { commandType: _commandType, request, ...reviewRequest } = command;
      return applyAgentCurrentImagePreviewLoopReviewedEdit(
        agentCurrentImagePreviewLoopApplyReviewRequestSchema.parse({
          ...reviewRequest,
          request,
        }),
      );
    },
  });
