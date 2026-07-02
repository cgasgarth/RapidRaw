import { beforeEach, describe, expect, test } from 'bun:test';

import {
  RawEngineLocalAppServerCommandType,
  rawEngineLocalAppServerEditorStateResultV1Schema,
  rawEngineLocalAppServerImageMetadataResultV1Schema,
  rawEngineLocalAppServerProjectMetadataResultV1Schema,
  rawEngineLocalAppServerSelectedImagesResultV1Schema,
} from '../../../packages/rawengine-schema/src/localAppServerBridge';
import { RawStatus, SortDirection } from '../../../src/components/ui/AppProperties';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { useLibraryStore } from '../../../src/store/useLibraryStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { createLiveEditorAppServerBridge } from '../../../src/utils/agent/session/agentLiveEditorState';

const firstPath = '/fixtures/agent-live-read-queries/IMG_4794_A.CR3';
const secondPath = '/fixtures/agent-live-read-queries/IMG_4794_B.CR3';

const seedStores = (activePath = firstPath) => {
  useLibraryStore.getState().setLibrary({
    activeAlbumId: 'album_issue_4794',
    albumTree: [
      {
        id: 'album_issue_4794',
        images: [activePath],
        name: 'Issue 4794',
        type: 'album',
      },
    ],
    currentFolderPath: '/fixtures/agent-live-read-queries',
    filterCriteria: { colors: ['green'], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
    folderTrees: [],
    imageList: [
      {
        exif: { ISO: activePath === firstPath ? '100' : '640', LensModel: 'Live Read 50mm' },
        is_edited: activePath === secondPath,
        is_virtual_copy: false,
        modified: activePath === firstPath ? 1_783_382_400 : 1_783_468_800,
        path: activePath,
        rating: activePath === firstPath ? 3 : 5,
        tags: activePath === firstPath ? ['before'] : ['after', 'live'],
      },
    ],
    imageRatings: { [activePath]: activePath === firstPath ? 3 : 5 },
    libraryActivePath: activePath,
    multiSelectedPaths: [activePath],
    pinnedFolderTrees: [],
    rootPaths: ['/fixtures/agent-live-read-queries'],
    sortCriteria: { key: 'rating', label: 'Rating', order: SortDirection.Descending },
  });

  useEditorStore.getState().setEditor({
    adjustments: { ...INITIAL_ADJUSTMENTS, exposure: 0.25 },
    finalPreviewUrl: `blob:rawengine-issue-4794-${activePath === firstPath ? 'a' : 'b'}`,
    hasRenderedFirstFrame: true,
    history: [INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, exposure: 0.25 }],
    historyCheckpoints: [],
    historyIndex: 1,
    lastBasicToneCommand: null,
    selectedImage: {
      exif: { ISO: activePath === firstPath ? '100' : '640', LensModel: 'Live Read 50mm' },
      height: 4024,
      isRaw: true,
      isReady: true,
      originalUrl: `blob:rawengine-original-${activePath === firstPath ? 'a' : 'b'}`,
      path: activePath,
      thumbnailUrl: `blob:rawengine-thumb-${activePath === firstPath ? 'a' : 'b'}`,
      width: 6048,
    },
  });
};

const buildReadQuery = (commandType: RawEngineLocalAppServerCommandType) => ({
  commandId: `command_${commandType.replaceAll('.', '_')}`,
  commandType,
  correlationId: `corr_${commandType.replaceAll('.', '_')}`,
  dryRun: false,
  requestId: `request_${commandType.replaceAll('.', '_')}`,
});

describe('agent app-server live read queries', () => {
  beforeEach(() => {
    seedStores();
  });

  test('reuse one bridge instance while reading current library and editor store state', async () => {
    const bridge = createLiveEditorAppServerBridge();

    const firstMetadataResult = await bridge.dispatch({
      ...buildReadQuery(RawEngineLocalAppServerCommandType.ImageMetadataQuery),
      imagePath: firstPath,
    });
    if (!firstMetadataResult.ok) throw new Error(firstMetadataResult.message);
    const firstMetadata = rawEngineLocalAppServerImageMetadataResultV1Schema.parse(firstMetadataResult.result);
    expect(firstMetadata.image.path).toBe(firstPath);
    expect(firstMetadata.image.rating).toBe(3);

    seedStores(secondPath);

    const projectResult = await bridge.dispatch(
      buildReadQuery(RawEngineLocalAppServerCommandType.ProjectMetadataQuery),
    );
    if (!projectResult.ok) throw new Error(projectResult.message);
    const project = rawEngineLocalAppServerProjectMetadataResultV1Schema.parse(projectResult.result);
    expect(project.libraryActivePath).toBe(secondPath);
    expect(project.selectedCount).toBe(1);
    expect(project.imageCount).toBe(1);

    const selectedResult = await bridge.dispatch(
      buildReadQuery(RawEngineLocalAppServerCommandType.SelectedImagesQuery),
    );
    if (!selectedResult.ok) throw new Error(selectedResult.message);
    const selected = rawEngineLocalAppServerSelectedImagesResultV1Schema.parse(selectedResult.result);
    expect(selected.selectedPaths).toEqual([secondPath]);
    expect(selected.images[0]?.path).toBe(secondPath);
    expect(selected.images[0]?.tags).toEqual(['after', 'live']);

    const editorResult = await bridge.dispatch(buildReadQuery(RawEngineLocalAppServerCommandType.EditorStateQuery));
    if (!editorResult.ok) throw new Error(editorResult.message);
    const editor = rawEngineLocalAppServerEditorStateResultV1Schema.parse(editorResult.result);
    expect(editor.activeImagePath).toBe(secondPath);
    expect(editor.selectedImagePaths).toEqual([secondPath]);

    const secondMetadataResult = await bridge.dispatch({
      ...buildReadQuery(RawEngineLocalAppServerCommandType.ImageMetadataQuery),
      imagePath: secondPath,
    });
    if (!secondMetadataResult.ok) throw new Error(secondMetadataResult.message);
    const secondMetadata = rawEngineLocalAppServerImageMetadataResultV1Schema.parse(secondMetadataResult.result);
    expect(secondMetadata.image.exif?.ISO).toBe('640');
    expect(secondMetadata.image.rating).toBe(5);
  });

  test('read queries do not mutate adjustments or edit history', async () => {
    const bridge = createLiveEditorAppServerBridge();
    const before = useEditorStore.getState();
    const beforeAdjustments = structuredClone(before.adjustments);
    const beforeHistory = structuredClone(before.history);
    const beforeHistoryCheckpoints = structuredClone(before.historyCheckpoints);

    for (const commandType of [
      RawEngineLocalAppServerCommandType.ProjectMetadataQuery,
      RawEngineLocalAppServerCommandType.SelectedImagesQuery,
      RawEngineLocalAppServerCommandType.EditorStateQuery,
    ]) {
      const result = await bridge.dispatch(buildReadQuery(commandType));
      expect(result.ok).toBe(true);
    }

    const metadataResult = await bridge.dispatch({
      ...buildReadQuery(RawEngineLocalAppServerCommandType.ImageMetadataQuery),
      imagePath: firstPath,
    });
    expect(metadataResult.ok).toBe(true);

    const after = useEditorStore.getState();
    expect(after.adjustments).toEqual(beforeAdjustments);
    expect(after.history).toEqual(beforeHistory);
    expect(after.historyCheckpoints).toEqual(beforeHistoryCheckpoints);
    expect(after.historyIndex).toBe(before.historyIndex);
    expect(after.lastBasicToneCommand).toBeNull();
  });

  test('image metadata query returns a stable not-found validation error', async () => {
    const bridge = createLiveEditorAppServerBridge();
    const missingPath = '/fixtures/agent-live-read-queries/MISSING.CR3';

    const result = await bridge.dispatch({
      ...buildReadQuery(RawEngineLocalAppServerCommandType.ImageMetadataQuery),
      imagePath: missingPath,
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      message: `Local app-server bridge has no image metadata for ${missingPath}.`,
      reason: 'handler_failed',
    });
  });
});
