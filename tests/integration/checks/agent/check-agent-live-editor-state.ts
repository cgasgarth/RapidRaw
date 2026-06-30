#!/usr/bin/env bun

import {
  RawEngineLocalAppServerCommandType,
  rawEngineLocalAppServerEditorStateResultV1Schema,
  rawEngineLocalAppServerImageMetadataResultV1Schema,
  rawEngineLocalAppServerSelectedImagesResultV1Schema,
} from '../../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import { RawStatus, SortDirection } from '../../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../../src/store/useLibraryStore.ts';
import { createLiveEditorAppServerBridge } from '../../../../src/utils/agent/session/agentLiveEditorState.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3154.ARW';
const virtualCopyPath = `${selectedPath}?vc=agent-live-state`;

useLibraryStore.getState().setLibrary({
  activeAlbumId: 'album_alaska_selects',
  albumTree: [{ id: 'album_alaska_selects', images: [virtualCopyPath], name: 'Alaska Selects', type: 'album' }],
  currentFolderPath: '/Users/cgas/Pictures/Capture One/Alaska',
  filterCriteria: { colors: ['green'], editedStatus: 'editedOnly', rating: 4, rawStatus: RawStatus.RawOnly },
  folderTrees: [
    {
      children: [],
      hasSubdirs: false,
      imageCount: 1,
      isDir: true,
      name: 'Alaska',
      path: '/Users/cgas/Pictures/Capture One/Alaska',
    },
  ],
  imageList: [
    {
      exif: { ISO: '800', LensModel: 'FE 35mm F1.4 GM' },
      is_edited: true,
      is_virtual_copy: true,
      modified: 1_781_928_000,
      path: virtualCopyPath,
      rating: 5,
      tags: ['alaska', 'select'],
    },
  ],
  imageRatings: { [virtualCopyPath]: 5 },
  libraryActivePath: virtualCopyPath,
  multiSelectedPaths: [virtualCopyPath],
  pinnedFolderTrees: [],
  rootPaths: ['/Users/cgas/Pictures/Capture One'],
  sortCriteria: { key: 'rating', label: 'Rating', order: SortDirection.Descending },
});

useEditorStore.getState().setEditor({
  finalPreviewUrl: 'blob:rawengine-live-preview-3154',
  hasRenderedFirstFrame: true,
  selectedImage: {
    exif: { ISO: '800', LensModel: 'FE 35mm F1.4 GM' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3154',
    path: virtualCopyPath,
    thumbnailUrl: 'blob:rawengine-thumb-3154',
    width: 6000,
  },
});

const bridge = createLiveEditorAppServerBridge();
const context = { now: () => new Date('2026-06-22T12:00:00.000Z'), requestId: 'request_live_editor_state_3154' };

const editorStateResult = await bridge.dispatch(
  buildReadQuery(RawEngineLocalAppServerCommandType.EditorStateQuery),
  context,
);
if (!editorStateResult.ok) throw new Error(`Live editor state query failed: ${editorStateResult.message}`);
const editorState = rawEngineLocalAppServerEditorStateResultV1Schema.parse(editorStateResult.result);
if (editorState.activeImagePath !== virtualCopyPath) {
  throw new Error(`Expected active image ${virtualCopyPath}, got ${editorState.activeImagePath ?? 'null'}.`);
}
if (editorState.selectedImagePaths[0] !== virtualCopyPath || editorState.visibleImageCount !== 1) {
  throw new Error('Live editor state did not preserve selected image path and visible count.');
}

const selectedImagesResult = await bridge.dispatch(
  buildReadQuery(RawEngineLocalAppServerCommandType.SelectedImagesQuery),
  context,
);
if (!selectedImagesResult.ok) throw new Error(`Live selected images query failed: ${selectedImagesResult.message}`);
const selectedImages = rawEngineLocalAppServerSelectedImagesResultV1Schema.parse(selectedImagesResult.result);
if (selectedImages.images[0]?.exif?.LensModel !== 'FE 35mm F1.4 GM') {
  throw new Error('Selected image query did not return live EXIF metadata.');
}

const metadataResult = await bridge.dispatch(
  {
    ...buildReadQuery(RawEngineLocalAppServerCommandType.ImageMetadataQuery),
    imagePath: virtualCopyPath,
  },
  context,
);
if (!metadataResult.ok) throw new Error(`Live image metadata query failed: ${metadataResult.message}`);
const metadata = rawEngineLocalAppServerImageMetadataResultV1Schema.parse(metadataResult.result);
if (!metadata.image.tags?.includes('alaska') || metadata.image.rating !== 5) {
  throw new Error('Live image metadata query did not preserve tags/rating.');
}

console.log('agent live editor state ok (selected RAW + metadata)');

function buildReadQuery(commandType: RawEngineLocalAppServerCommandType) {
  const suffix = commandType.replaceAll('.', '_');
  return {
    commandId: `command_${suffix}`,
    commandType,
    correlationId: `corr_${suffix}`,
    dryRun: false,
    requestId: `request_${suffix}`,
  };
}
