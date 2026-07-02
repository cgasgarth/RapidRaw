import { beforeEach, describe, expect, test } from 'bun:test';

import { ToolType } from '../../../src/components/panel/right/layers/Masks';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import { applyAgentColor } from '../../../src/utils/agent/tools/agentColorApplyTool';

const selectedPath = '/fixtures/agent-color-apply/DSC_4751.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 10 : 3));

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-color-apply-before',
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
      originalUrl: 'blob:rawengine-agent-color-apply-original',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-agent-color-apply-thumb',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: 'blob:rawengine-agent-color-apply-stale',
  });
};

describe('agent color apply preview refresh', () => {
  beforeEach(() => {
    seedEditor();
  });

  test('refreshes the preview after applying HSL and selective-color commands', async () => {
    const beforeSnapshot = buildAgentImageContextSnapshot();
    const result = await applyAgentColor({
      color: {
        hsl: {
          oranges: { hue: 5, luminance: 2, saturation: 12 },
        },
        selectiveColorRangeControls: {
          oranges: { centerHueDegrees: 28, falloffSmoothness: 1.5, widthDegrees: 52 },
        },
      },
      expectedRecipeHash: beforeSnapshot.initialPreview.recipeHash,
      operationId: 'agent_color_apply_preview_refresh',
      requestId: 'agent-color-apply-preview-refresh',
      sessionId: 'agent-color-apply-preview-refresh',
    });
    const afterSnapshot = buildAgentImageContextSnapshot();

    expect(result.toolName).toBe('rawengine.agent.color.apply');
    expect(result.previewAfter.purpose).toBe('refresh');
    expect(result.afterPreviewHash).toBe(result.previewAfter.renderHash);
    expect(result.previewAfter.recipeHash).toBe(afterSnapshot.initialPreview.recipeHash);
    expect(result.previewAfter.artifactId).toMatch(/^artifact_refresh_/);
    expect(result.beforePreviewHash).not.toBe(result.afterPreviewHash);
    expect(result.receipt.typedCommands).toHaveLength(1);
    expect(result.receipt.typedCommands?.[0]?.commandType).toBe('toneColor.adjustHsl');
    expect(useEditorStore.getState().uncroppedAdjustedPreviewUrl).toBeNull();
    expect(useEditorStore.getState().adjustments.hsl.oranges.saturation).toBe(12);
    expect(useEditorStore.getState().adjustments.selectiveColorRangeControls.oranges.widthDegrees).toBe(52);
  });
});
