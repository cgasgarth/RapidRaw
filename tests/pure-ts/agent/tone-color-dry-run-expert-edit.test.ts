import { beforeEach, describe, expect, test } from 'bun:test';

import { RawStatus, SortDirection } from '../../../src/components/ui/AppProperties';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { useLibraryStore } from '../../../src/store/useLibraryStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import { buildAgentToneColorDryRunExpertEdit } from '../../../src/utils/agent/context/agentToneColorDryRunExpertEdit';

const selectedPath = '/fixtures/agent-tone-color/IMG_4701.ARW';

const seedSelectedImage = () => {
  useLibraryStore.getState().setLibrary({
    activeAlbumId: 'album_agent_tone_color_dry_run',
    albumTree: [
      {
        id: 'album_agent_tone_color_dry_run',
        images: [selectedPath],
        name: 'Tone Color Dry Run',
        type: 'album',
      },
    ],
    currentFolderPath: '/fixtures/agent-tone-color',
    filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
    folderTrees: [],
    imageList: [
      {
        exif: { ISO: '200', LensModel: 'FE 35mm F1.4 GM' },
        is_edited: false,
        is_virtual_copy: false,
        modified: 1_783_036_800,
        path: selectedPath,
        rating: 4,
        tags: ['agent-tone-color-dry-run'],
      },
    ],
    imageRatings: { [selectedPath]: 4 },
    libraryActivePath: selectedPath,
    multiSelectedPaths: [selectedPath],
    pinnedFolderTrees: [],
    rootPaths: ['/fixtures/agent-tone-color'],
    sortCriteria: { key: 'rating', label: 'Rating', order: SortDirection.Descending },
  });

  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    finalPreviewUrl: 'blob:rawengine-agent-tone-color-before',
    hasRenderedFirstFrame: true,
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: {
      exif: { ISO: '200', LensModel: 'FE 35mm F1.4 GM' },
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:rawengine-agent-tone-color-original',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-agent-tone-color-thumb',
      width: 6000,
    },
  });
};

describe('agent tone/color dry-run expert edit', () => {
  beforeEach(() => {
    seedSelectedImage();
  });

  test('maps a supported prompt to deterministic tone/color dry-run artifacts', async () => {
    const snapshot = buildAgentImageContextSnapshot();
    const result = await buildAgentToneColorDryRunExpertEdit({
      expectedGraphRevision: snapshot.graphRevision,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      operationId: 'issue_4701_brighten_contrast',
      prompt: 'Brighten this RAW, recover highlights, add contrast, and warm the white balance.',
      sessionId: 'agent-tone-color-dry-run-test',
    });

    expect(result.intents).toEqual(['recover_highlights', 'warm_white_balance', 'contrast', 'brighten']);
    expect(result.commands.map((command) => command.commandType)).toEqual([
      'toneColor.setBasicTone',
      'toneColor.adjustHsl',
    ]);
    expect(result.dryRuns).toHaveLength(2);
    expect(result.dryRuns.every((dryRun) => dryRun.dryRun && !dryRun.mutates)).toBe(true);
    expect(result.beforePreviewHash).not.toBe(result.afterPreviewHash);
    expect(result.changedPixelPercent).toBe(100);
    expect(result.graphRevisionBefore).toBe('history_0');
    expect(result.graphRevisionAfter).toBe('history_0');
    expect(result.artifactReview.previewArtifacts).toHaveLength(2);
    expect(result.artifactReview.previewArtifacts[1]?.status).toBe('review_required');
    expect(result.dryRunReview.affectedTargets.find((target) => target.id === 'tool-route')?.value).toBe(
      'tonecolor.dry_run_command',
    );
    expect(useEditorStore.getState().historyIndex).toBe(0);
    expect(useEditorStore.getState().adjustments.exposure).toBe(INITIAL_ADJUSTMENTS.exposure);
  });

  test('validates unsupported prompt requests', async () => {
    await expect(
      buildAgentToneColorDryRunExpertEdit({
        operationId: 'issue_4701_unsupported',
        prompt: 'Please remove the telephone pole from the background.',
        sessionId: 'agent-tone-color-dry-run-test',
      }),
    ).rejects.toThrow('Unsupported tone/color dry-run request');
  });

  test('rejects stale graph and recipe inputs before dispatch', async () => {
    const snapshot = buildAgentImageContextSnapshot();

    await expect(
      buildAgentToneColorDryRunExpertEdit({
        expectedGraphRevision: 'history_99',
        operationId: 'issue_4701_stale_graph',
        prompt: 'Increase saturation and add contrast.',
        sessionId: 'agent-tone-color-dry-run-test',
      }),
    ).rejects.toThrow('stale graph revision');

    await expect(
      buildAgentToneColorDryRunExpertEdit({
        expectedGraphRevision: snapshot.graphRevision,
        expectedRecipeHash: 'recipe:stale',
        operationId: 'issue_4701_stale_recipe',
        prompt: 'Increase saturation and add contrast.',
        sessionId: 'agent-tone-color-dry-run-test',
      }),
    ).rejects.toThrow('stale recipe hash');
  });
});
