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
import { applyAgentGeometry } from '../../../src/utils/agent/tools/agentGeometryApplyTool';
import {
  buildAgentToolEditTransaction,
  captureAgentToolCommitIdentity,
} from '../../../src/utils/agentToolEditTransaction';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixtures/agent-geometry.ARW';
const session = createEditorImageSession({ generation: 41, path: sourcePath, source: 'cache' });

class DeferredGeometryBridge extends RawEngineLocalAppServerBridge {
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
      command.commandType === 'editGraph.applyParameterPatch' &&
      'dryRun' in command &&
      command.dryRun === false
    ) {
      this.signalApplyEntered();
      await this.applyGate;
    }
    return super.dispatch<TResult>(command, context);
  }
}

describe('agent geometry EditTransaction bridge', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:agent-geometry-current',
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
      uncroppedAdjustedPreviewUrl: 'blob:agent-geometry-uncropped',
      history: [editDocumentV2],
    });
  });

  test('rejects an accepted typed result after an intervening editor revision', async () => {
    const snapshot = buildAgentImageContextSnapshot();
    const bridge = new DeferredGeometryBridge();
    const pending = applyAgentGeometry(
      {
        expectedRecipeHash: snapshot.initialPreview.recipeHash,
        geometry: { rotation: 2 },
        operationId: 'delayed-agent-geometry',
        requestId: 'delayed-agent-geometry-request',
        sessionId: 'agent-geometry-test',
      },
      bridge,
    );
    await bridge.applyEntered;
    const state = useEditorStore.getState();
    state.applyEditTransaction({
      baseAdjustmentRevision: state.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [{ patch: { contrast: 14 }, type: 'patch-adjustments' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'intervening-geometry-edit',
    });
    bridge.releaseApply();

    await expect(pending).rejects.toThrow('agent_tool_transaction.stale_revision:0:1');
    const after = useEditorStore.getState();
    expect(after.editDocumentV2.nodes['scene_global_color_tone']!.params['contrast']).toBe(14);
    expect(after.editDocumentV2.geometry.rotation).toBe(0);
    expect(after.lastEditApplicationReceipt?.transactionId).toBe('intervening-geometry-edit');
  });

  test('rejects source and image-session changes before constructing a commit', () => {
    const state = useEditorStore.getState();
    const identity = captureAgentToolCommitIdentity(state);
    if (identity === null) throw new Error('Expected seeded agent-tool identity.');
    const nextAdjustments = { ...state.adjustmentSnapshot.value, rotation: 2 };
    expect(() =>
      buildAgentToolEditTransaction(
        { ...state, selectedImage: { path: '/fixtures/other.ARW' } },
        identity,
        nextAdjustments,
        'stale-source',
      ),
    ).toThrow(`agent_tool_transaction.stale_source:${sourcePath}:/fixtures/other.ARW`);
    expect(() =>
      buildAgentToolEditTransaction(
        { ...state, imageSession: { id: 'other-session' } },
        identity,
        nextAdjustments,
        'stale-session',
      ),
    ).toThrow(`agent_tool_transaction.stale_session:${session.id}:other-session`);
  });
});
