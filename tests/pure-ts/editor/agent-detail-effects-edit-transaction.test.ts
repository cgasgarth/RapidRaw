import { beforeEach, describe, expect, test } from 'bun:test';

import type {
  EditCommandBusContext,
  EditCommandDispatchResult,
} from '../../../packages/rawengine-schema/src/editCommandBus';
import { RawEngineLocalAppServerBridge } from '../../../packages/rawengine-schema/src/localAppServerBridge';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import { applyAgentDetailEffects } from '../../../src/utils/agent/tools/agentDetailEffectsApplyTool';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixtures/agent-detail-effects.ARW';
const session = createEditorImageSession({ generation: 52, path: sourcePath, source: 'cache' });

class DeferredDetailEffectsBridge extends RawEngineLocalAppServerBridge {
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
      command.commandType === 'detailEffects.applyAdjustments'
    ) {
      this.signalApplyEntered();
      await this.applyGate;
    }
    return super.dispatch<TResult>(command, context);
  }
}

describe('agent detail/effects EditTransaction bridge', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:agent-detail-effects-current',
      hasRenderedFirstFrame: true,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      imageSessionId: session.generation,
      lastEditApplicationReceipt: null,
      selectedImage: {
        exif: null,
        height: 3000,
        isRaw: true,
        isReady: true,
        metadata: null,
        originalUrl: null,
        path: sourcePath,
        rawDevelopmentReport: null,
        thumbnailUrl: '',
        width: 4000,
      },
      uncroppedAdjustedPreviewUrl: 'blob:agent-detail-effects-uncropped',
      history: [editDocumentV2],
    });
  });

  test('rejects an accepted typed result after an intervening editor revision', async () => {
    const snapshot = buildAgentImageContextSnapshot();
    const bridge = new DeferredDetailEffectsBridge();
    const pending = applyAgentDetailEffects(
      {
        detailEffects: { clarity: 18 },
        expectedRecipeHash: snapshot.initialPreview.recipeHash,
        operationId: 'delayed-agent-detail-effects',
        requestId: 'delayed-agent-detail-effects-request',
        sessionId: 'agent-detail-effects-test',
      },
      bridge,
    );
    await bridge.applyEntered;
    const state = useEditorStore.getState();
    state.applyEditTransaction({
      baseAdjustmentRevision: state.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [{ patch: { exposure: 0.2 }, type: 'patch-adjustments' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'intervening-detail-effects-edit',
    });
    bridge.releaseApply();

    await expect(pending).rejects.toThrow('agent_tool_transaction.stale_revision:0:1');
    const after = useEditorStore.getState();
    expect(after.editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.2);
    expect(after.editDocumentV2.nodes['detail_denoise_dehaze']!.params['clarity']).toBe(INITIAL_ADJUSTMENTS.clarity);
    expect(after.lastEditApplicationReceipt?.transactionId).toBe('intervening-detail-effects-edit');
  });

  test('skips typed dispatch and editor work for an exact repeat', async () => {
    const snapshot = buildAgentImageContextSnapshot();
    const before = useEditorStore.getState();
    const result = await applyAgentDetailEffects({
      detailEffects: { clarity: INITIAL_ADJUSTMENTS.clarity },
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      operationId: 'agent-detail-effects-no-op',
      requestId: 'agent-detail-effects-no-op-request',
      sessionId: 'agent-detail-effects-test',
    });
    const after = useEditorStore.getState();

    expect(result.adjustedFields).toEqual([]);
    expect(result.changedPixelCount).toBe(0);
    expect(result.beforePreviewHash).toBe(result.afterPreviewHash);
    expect(result.receipt.typedCommand).toBeUndefined();
    expect(after.adjustmentRevision).toBe(before.adjustmentRevision);
    expect(after.historyIndex).toBe(before.historyIndex);
    expect(after.lastEditApplicationReceipt).toBe(before.lastEditApplicationReceipt);
  });
});
