import { beforeEach, describe, expect, test } from 'bun:test';

import { ToolType } from '../../../src/components/panel/right/layers/Masks';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildAgentMediumPreviewArtifact,
  buildAgentMediumPreviewEncodedBytesForTest,
} from '../../../src/utils/agent/context/agentMediumPreviewArtifactRuntime';
import {
  getRawEngineImagePreview,
  renderAgentReadOnlyPreview,
} from '../../../src/utils/agent/context/agentReadOnlyAppServerTools';
import { applyBasicToneToLiveEditor } from '../../../src/utils/agent/session/agentLiveBasicTone';

const selectedPath = '/fixtures/pure-ts/agent-preview-artifacts/DSC_4844.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 7 : 3));

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-medium-preview-4844',
    hasRenderedFirstFrame: true,
    histogram: {
      [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
      [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
      [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
      [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
    },
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: {
      exif: { ISO: '400', LensModel: 'FE 24-70mm F2.8 GM II' },
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'file:///private/raw/not-serialized/DSC_4844.ARW',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-agent-medium-preview-4844-thumb',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

const readSof0Dimensions = (bytes: Uint8Array): { height: number; width: number } => {
  for (let index = 2; index < bytes.length - 8; ) {
    if (bytes[index] !== 0xff) {
      index += 1;
      continue;
    }
    const marker = bytes[index + 1];
    const length = ((bytes[index + 2] ?? 0) << 8) | (bytes[index + 3] ?? 0);
    if (marker === 0xc0) {
      return {
        height: ((bytes[index + 5] ?? 0) << 8) | (bytes[index + 6] ?? 0),
        width: ((bytes[index + 7] ?? 0) << 8) | (bytes[index + 8] ?? 0),
      };
    }
    index += Math.max(length + 2, 2);
  }
  throw new Error('Missing JPEG SOF0 dimensions.');
};

describe('agent medium preview artifact runtime', () => {
  beforeEach(() => {
    seedEditor();
  });

  test('backs image get-preview with deterministic medium JPEG artifact evidence', () => {
    const observed = getRawEngineImagePreview({ requestId: 'issue-4844-get-preview' });
    const encoded = buildAgentMediumPreviewEncodedBytesForTest({
      graphRevision: observed.editRevision.graphRevision,
      imagePath: selectedPath,
      preview: observed.preview,
    });

    expect(observed.mediumPreview.contentHash).toBe(observed.receipt.contentHash);
    expect(observed.mediumPreview.dimensions).toEqual({ height: 1024, width: 1536 });
    expect(observed.mediumPreview.longEdgePx).toBe(1536);
    expect(observed.mediumPreview.quality).toBe(0.86);
    expect(observed.mediumPreview.staleRecipeHash).toBe(false);
    expect(encoded[0]).toBe(0xff);
    expect(encoded[1]).toBe(0xd8);
    expect(encoded.at(-2)).toBe(0xff);
    expect(encoded.at(-1)).toBe(0xd9);
    expect(readSof0Dimensions(encoded)).toEqual(observed.mediumPreview.dimensions);
  });

  test('marks stale render requests while preserving artifact-backed receipt hashes', () => {
    const refresh = renderAgentReadOnlyPreview({
      expectedRecipeHash: 'recipe:stale',
      purpose: 'detail_review',
      requestId: 'issue-4844-stale-render',
      turn: 2,
    });

    expect(refresh.staleRecipeHash).toBe(true);
    expect(refresh.artifact.staleRecipeHash).toBe(true);
    expect(refresh.receipt?.contentHash).toBe(refresh.artifact.contentHash);
    expect(refresh.receipt?.preview.includesOriginalRaw).toBe(false);
  });

  test('changes artifact hash after a live adjustment changes the rendered recipe', async () => {
    const before = getRawEngineImagePreview({ requestId: 'issue-4844-before-edit' });

    await applyBasicToneToLiveEditor({
      expectedGraphRevision: before.receipt.graphRevision,
      operationId: 'issue_4844_preview_artifact_edit',
      requestedAdjustments: {
        blacks: INITIAL_ADJUSTMENTS.blacks,
        brightness: INITIAL_ADJUSTMENTS.brightness,
        clarity: INITIAL_ADJUSTMENTS.clarity,
        contrast: INITIAL_ADJUSTMENTS.contrast,
        exposure: 0.42,
        highlights: -18,
        saturation: INITIAL_ADJUSTMENTS.saturation,
        shadows: 20,
        whites: INITIAL_ADJUSTMENTS.whites,
      },
      sessionId: 'issue-4844-preview-artifact-runtime',
    });

    const after = renderAgentReadOnlyPreview({
      expectedRecipeHash: before.preview.recipeHash,
      purpose: 'refresh',
      requestId: 'issue-4844-after-edit',
      sourceToolName: 'rawengine.agent.adjustments.apply',
      turn: useEditorStore.getState().historyIndex,
    });

    expect(after.preview.recipeHash).not.toBe(before.preview.recipeHash);
    expect(after.artifact.contentHash).not.toBe(before.mediumPreview.contentHash);
    expect(after.receipt?.contentHash).toBe(after.artifact.contentHash);
    expect(after.preview.includesOriginalRaw).toBe(false);
    expect(JSON.stringify(after)).not.toContain('file:///private/raw/not-serialized');
  });

  test('hashes the encoded artifact bytes, not a thumbnail-only metadata seed', () => {
    const observed = getRawEngineImagePreview({ requestId: 'issue-4844-byte-hash' });
    const rebuiltArtifact = buildAgentMediumPreviewArtifact({
      graphRevision: observed.editRevision.graphRevision,
      imagePath: selectedPath,
      preview: observed.preview,
      staleRecipeHash: false,
    });

    expect(rebuiltArtifact.contentHash).toBe(observed.mediumPreview.contentHash);
    expect(observed.mediumPreview.contentHash).not.toBe(`sha256:${observed.preview.renderHash}`);
    expect(observed.preview.previewRef).toBe('blob:rawengine-agent-medium-preview-4844');
  });
});
