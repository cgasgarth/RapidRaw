#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  RawEngineLocalAppServerCommandType,
  rawEngineLocalAppServerEditorStateResultV1Schema,
  rawEngineLocalAppServerImageMetadataResultV1Schema,
  rawEngineLocalAppServerProjectMetadataResultV1Schema,
  rawEngineLocalAppServerSelectedImagesResultV1Schema,
} from '../../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import { RAW_ENGINE_SCHEMA_VERSION } from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { RawStatus, SortDirection } from '../../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../../src/store/useLibraryStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { createLiveEditorAppServerBridge } from '../../../../src/utils/agent/session/agentLiveEditorState.ts';

const REPORT_PATH = 'docs/validation/proofs/agent/agent-live-app-server-read-queries-2026-07-02.json';
const UPDATE_REPORT = process.env.UPDATE_AGENT_LIVE_APP_SERVER_READ_QUERIES_PROOF === '1';
const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3154.ARW';
const virtualCopyPath = `${selectedPath}?vc=agent-live-state`;
const secondPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3155.ARW';

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
  adjustments: { ...INITIAL_ADJUSTMENTS, exposure: 0.35 },
  finalPreviewUrl: 'blob:rawengine-live-preview-3154',
  hasRenderedFirstFrame: true,
  history: [INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, exposure: 0.35 }],
  historyCheckpoints: [],
  historyIndex: 1,
  lastBasicToneCommand: null,
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
const beforeReadState = useEditorStore.getState();
const beforeAdjustments = structuredClone(beforeReadState.adjustments);
const beforeHistory = structuredClone(beforeReadState.history);
const beforeHistoryIndex = beforeReadState.historyIndex;

const projectMetadataResult = await bridge.dispatch(
  buildReadQuery(RawEngineLocalAppServerCommandType.ProjectMetadataQuery),
  context,
);
if (!projectMetadataResult.ok) throw new Error(`Live project metadata query failed: ${projectMetadataResult.message}`);
const projectMetadata = rawEngineLocalAppServerProjectMetadataResultV1Schema.parse(projectMetadataResult.result);
if (projectMetadata.libraryActivePath !== virtualCopyPath || projectMetadata.selectedCount !== 1) {
  throw new Error('Live project metadata query did not preserve active path and selection count.');
}

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

useLibraryStore.getState().setLibrary({
  imageList: [
    {
      exif: { ISO: '1250', LensModel: 'FE 24-70mm F2.8 GM II' },
      is_edited: false,
      is_virtual_copy: false,
      modified: 1_781_929_200,
      path: secondPath,
      rating: 2,
      tags: ['alaska', 'live-refresh'],
    },
  ],
  imageRatings: { [secondPath]: 2 },
  libraryActivePath: secondPath,
  multiSelectedPaths: [secondPath],
});
useEditorStore.getState().setEditor({
  finalPreviewUrl: 'blob:rawengine-live-preview-3155',
  selectedImage: {
    exif: { ISO: '1250', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4024,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3155',
    path: secondPath,
    thumbnailUrl: 'blob:rawengine-thumb-3155',
    width: 6048,
  },
});

const refreshedSelectedImagesResult = await bridge.dispatch(
  buildReadQuery(RawEngineLocalAppServerCommandType.SelectedImagesQuery),
  context,
);
if (!refreshedSelectedImagesResult.ok) {
  throw new Error(`Refreshed selected images query failed: ${refreshedSelectedImagesResult.message}`);
}
const refreshedSelectedImages = rawEngineLocalAppServerSelectedImagesResultV1Schema.parse(
  refreshedSelectedImagesResult.result,
);
if (refreshedSelectedImages.selectedPaths[0] !== secondPath || refreshedSelectedImages.images[0]?.rating !== 2) {
  throw new Error('Reused live bridge did not read refreshed selected image state.');
}

const missingPath = '/Users/cgas/Pictures/Capture One/Alaska/MISSING_4794.ARW';
const missingMetadataResult = await bridge.dispatch(
  {
    ...buildReadQuery(RawEngineLocalAppServerCommandType.ImageMetadataQuery),
    imagePath: missingPath,
  },
  context,
);
if (
  missingMetadataResult.ok ||
  missingMetadataResult.message !== `Local app-server bridge has no image metadata for ${missingPath}.`
) {
  throw new Error('Missing image metadata query did not return the stable not-found validation error.');
}

const afterReadState = useEditorStore.getState();
if (
  JSON.stringify(afterReadState.adjustments) !== JSON.stringify(beforeAdjustments) ||
  JSON.stringify(afterReadState.history) !== JSON.stringify(beforeHistory) ||
  afterReadState.historyIndex !== beforeHistoryIndex
) {
  throw new Error('Live app-server read queries mutated editor adjustments or history.');
}

const proof = {
  generatedAt: '2026-07-02T00:00:00.000Z',
  issue: 4794,
  liveAfterBridgeConstruction: {
    initialActivePath: virtualCopyPath,
    refreshedActivePath: refreshedSelectedImages.selectedPaths[0],
    refreshedIso: refreshedSelectedImages.images[0]?.exif?.ISO,
    reusedBridgeInstance: true,
  },
  notFoundValidation: {
    imagePath: missingPath,
    message: missingMetadataResult.message,
    reason: missingMetadataResult.reason,
  },
  proofHash: hashJson({
    editorState,
    metadata,
    projectMetadata,
    refreshedSelectedImages,
    selectedImages,
  }),
  readOnlySafety: {
    adjustmentsHashAfter: hashJson(afterReadState.adjustments),
    adjustmentsHashBefore: hashJson(beforeAdjustments),
    historyHashAfter: hashJson(afterReadState.history),
    historyHashBefore: hashJson(beforeHistory),
    historyIndexAfter: afterReadState.historyIndex,
    historyIndexBefore: beforeHistoryIndex,
    mutates: false,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  supportedReads: [
    {
      result: { imageCount: projectMetadata.imageCount, selectedCount: projectMetadata.selectedCount },
      toolName: 'agent.project_metadata.query',
    },
    {
      result: { selectedPaths: selectedImages.selectedPaths },
      toolName: 'agent.selected_images.query',
    },
    {
      result: { imagePath: metadata.image.path, rating: metadata.image.rating },
      toolName: 'agent.image_metadata.query',
    },
    {
      result: {
        activeImagePath: editorState.activeImagePath,
        selectedImagePaths: editorState.selectedImagePaths,
        visibleImageCount: editorState.visibleImageCount,
      },
      toolName: 'agent.editor_state.query',
    },
  ],
  validationMode: 'agent_live_app_server_read_queries',
};

const proofText = `${JSON.stringify(proof, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, proofText);
} else {
  const expected = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
  if (JSON.stringify(expected) !== JSON.stringify(proof)) {
    throw new Error(
      `${REPORT_PATH} is stale; run UPDATE_AGENT_LIVE_APP_SERVER_READ_QUERIES_PROOF=1 bun tests/integration/checks/agent/check-agent-live-editor-state.ts.`,
    );
  }
}

console.log('agent live editor state ok (live read queries + no history mutation proof)');

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

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
