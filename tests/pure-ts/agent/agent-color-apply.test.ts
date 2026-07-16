import { beforeEach, describe, expect, test } from 'bun:test';

import type {
  EditCommandBusContext,
  EditCommandDispatchResult,
} from '../../../packages/rawengine-schema/src/editCommandBus';
import { RawEngineLocalAppServerBridge } from '../../../packages/rawengine-schema/src/localAppServerBridge';
import { ToolType } from '../../../src/components/panel/right/layers/Masks';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import { applyAgentColor } from '../../../src/utils/agent/tools/agentColorApplyTool';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const selectedPath = '/fixtures/agent-color-apply/DSC_4751.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 10 : 3));

class DeferredColorBridge extends RawEngineLocalAppServerBridge {
  private releaseApplyGate: () => void = () => undefined;
  private signalApplyEntered: () => void = () => undefined;
  readonly applyEntered = new Promise<void>((resolve) => {
    this.signalApplyEntered = resolve;
  });
  private readonly applyGate = new Promise<void>((resolve) => {
    this.releaseApplyGate = resolve;
  });

  releaseApply(): void {
    this.releaseApplyGate();
  }

  override async dispatch<TResult = unknown>(
    command: unknown,
    context?: EditCommandBusContext,
  ): Promise<EditCommandDispatchResult<TResult>> {
    if (
      typeof command === 'object' &&
      command !== null &&
      'commandType' in command &&
      command.commandType === 'toneColor.adjustHsl' &&
      'dryRun' in command &&
      command.dryRun === false
    ) {
      this.signalApplyEntered();
      await this.applyGate;
    }
    return super.dispatch<TResult>(command, context);
  }
}

const seedEditor = () => {
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-color-apply-before',
    hasRenderedFirstFrame: true,
    histogram: {
      [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
      [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
      [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
      [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
    },
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
    editDocumentV2,
    history: [editDocumentV2],
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
    expect(useEditorStore.getState().adjustmentSnapshot.value.hsl.oranges.saturation).toBe(12);
    expect(useEditorStore.getState().adjustmentSnapshot.value.selectiveColorRangeControls.oranges.widthDegrees).toBe(
      52,
    );
  });

  test('rejects an accepted typed color result after an intervening editor revision', async () => {
    const beforeSnapshot = buildAgentImageContextSnapshot();
    const bridge = new DeferredColorBridge();
    const pending = applyAgentColor(
      {
        color: { hsl: { oranges: { hue: 5, luminance: 2, saturation: 12 } } },
        expectedRecipeHash: beforeSnapshot.initialPreview.recipeHash,
        operationId: 'agent_color_delayed',
        requestId: 'agent-color-delayed',
        sessionId: 'agent-color-delayed',
      },
      bridge,
    );
    await bridge.applyEntered;
    const state = useEditorStore.getState();
    const baseRevision = state.adjustmentRevision;
    if (state.imageSession === null) throw new Error('Expected seeded image session.');
    state.applyEditTransaction({
      baseAdjustmentRevision: state.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: state.imageSession.id,
      operations: [{ patch: { exposure: 0.2 }, type: 'patch-adjustments' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'intervening-color-edit',
    });
    bridge.releaseApply();

    await expect(pending).rejects.toThrow(
      `agent_tool_transaction.stale_revision:${String(baseRevision)}:${String(baseRevision + 1)}`,
    );
    const after = useEditorStore.getState();
    expect(after.adjustmentSnapshot.value.exposure).toBe(0.2);
    expect(after.adjustmentSnapshot.value.hsl.oranges).toEqual(INITIAL_ADJUSTMENTS.hsl.oranges);
    expect(after.lastEditApplicationReceipt?.transactionId).toBe('intervening-color-edit');
  });

  test('treats an exact repeat as zero pixel, history, and persistence work', async () => {
    const beforeSnapshot = buildAgentImageContextSnapshot();
    const before = useEditorStore.getState();
    const result = await applyAgentColor({
      color: { vibrance: INITIAL_ADJUSTMENTS.vibrance },
      expectedRecipeHash: beforeSnapshot.initialPreview.recipeHash,
      operationId: 'agent_color_no_op',
      requestId: 'agent-color-no-op',
      sessionId: 'agent-color-no-op',
    });
    const after = useEditorStore.getState();

    expect(result.adjustedFields).toEqual([]);
    expect(result.changedPixelCount).toBe(0);
    expect(result.beforePreviewHash).toBe(result.afterPreviewHash);
    expect(after.adjustmentRevision).toBe(before.adjustmentRevision);
    expect(after.historyIndex).toBe(before.historyIndex);
    expect(after.lastEditApplicationReceipt).toBe(before.lastEditApplicationReceipt);
  });
});
