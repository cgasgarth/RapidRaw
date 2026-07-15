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
import { applyAgentLensProfile } from '../../../src/utils/agent/tools/agentLensProfileApplyTool';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixtures/agent-lens-profile.ARW';
const session = createEditorImageSession({ generation: 53, path: sourcePath, source: 'cache' });

class DeferredLensProfileBridge extends RawEngineLocalAppServerBridge {
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

  override async dispatch(command: unknown, context?: EditCommandBusContext): Promise<EditCommandDispatchResult> {
    if (
      typeof command === 'object' &&
      command !== null &&
      'commandType' in command &&
      command.commandType === 'lensProfile.applyCorrection'
    ) {
      this.signalApplyEntered();
      await this.applyGate;
    }
    return super.dispatch(command, context);
  }
}

describe('agent lens profile EditTransaction bridge', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.setState({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      finalPreviewUrl: 'blob:agent-lens-profile-current',
      hasRenderedFirstFrame: true,
      history: [adjustments],
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
      uncroppedAdjustedPreviewUrl: 'blob:agent-lens-profile-uncropped',
    });
  });

  test('rejects an accepted typed result after an intervening editor revision', async () => {
    const snapshot = buildAgentImageContextSnapshot();
    const bridge = new DeferredLensProfileBridge();
    const pending = applyAgentLensProfile(
      {
        expectedRecipeHash: snapshot.initialPreview.recipeHash,
        lensProfile: { lensDistortionAmount: 120 },
        operationId: 'delayed-agent-lens-profile',
        requestId: 'delayed-agent-lens-profile-request',
        sessionId: 'agent-lens-profile-test',
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
      transactionId: 'intervening-lens-profile-edit',
    });
    bridge.releaseApply();

    await expect(pending).rejects.toThrow('agent_tool_transaction.stale_revision:0:1');
    const after = useEditorStore.getState();
    expect(after.adjustments.exposure).toBe(0.2);
    expect(after.adjustments.lensDistortionAmount).toBe(INITIAL_ADJUSTMENTS.lensDistortionAmount);
    expect(after.lastEditApplicationReceipt?.transactionId).toBe('intervening-lens-profile-edit');
  });

  test('skips typed dispatch and editor work for an exact repeat', async () => {
    const snapshot = buildAgentImageContextSnapshot();
    const before = useEditorStore.getState();
    const result = await applyAgentLensProfile({
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      lensProfile: { lensDistortionAmount: INITIAL_ADJUSTMENTS.lensDistortionAmount },
      operationId: 'agent-lens-profile-no-op',
      requestId: 'agent-lens-profile-no-op-request',
      sessionId: 'agent-lens-profile-test',
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
