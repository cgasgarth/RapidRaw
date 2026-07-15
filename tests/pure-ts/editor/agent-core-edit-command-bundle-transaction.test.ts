import { beforeEach, describe, expect, test } from 'bun:test';

import type {
  EditCommandBusContext,
  EditCommandDispatchResult,
} from '../../../packages/rawengine-schema/src/editCommandBus';
import { RawEngineLocalAppServerBridge } from '../../../packages/rawengine-schema/src/localAppServerBridge';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { runAgentCoreEditCommandBundle } from '../../../src/utils/agent/planning/agentCoreEditCommandBundle';
import {
  buildAgentToolEditTransaction,
  captureAgentToolCommitIdentity,
} from '../../../src/utils/agentToolEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixtures/agent-core-bundle.ARW';
const session = createEditorImageSession({ generation: 61, path: sourcePath, source: 'cache' });

class DeferredBundleBridge extends RawEngineLocalAppServerBridge {
  private releaseGate: () => void = () => undefined;
  private signalEntered: () => void = () => undefined;
  readonly applyEntered = new Promise<void>((resolve) => {
    this.signalEntered = resolve;
  });
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });
  releaseApply(): void {
    this.releaseGate();
  }
  override async dispatch(command: unknown, context?: EditCommandBusContext): Promise<EditCommandDispatchResult> {
    if (
      typeof command === 'object' &&
      command !== null &&
      'commandType' in command &&
      command.commandType === 'toneColor.adjustHsl' &&
      'dryRun' in command &&
      command.dryRun === false
    ) {
      this.signalEntered();
      await this.gate;
    }
    return super.dispatch(command, context);
  }
}

describe('agent core command bundle transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.setState({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      finalPreviewUrl: 'blob:bundle-current',
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
      uncroppedAdjustedPreviewUrl: 'blob:bundle-uncropped',
    });
  });

  test('rejects a completed typed bundle after an intervening editor revision', async () => {
    const bridge = new DeferredBundleBridge();
    const pending = runAgentCoreEditCommandBundle({
      bridge,
      operationId: 'delayed-core-bundle',
      sessionId: 'core-bundle-test',
      steps: [
        { kind: 'basic_tone', payload: { ...INITIAL_ADJUSTMENTS, exposure: 0.3 } },
        {
          kind: 'selective_color',
          payload: { adjustment: { hue: 2, luminance: 1, saturation: 8 }, rangeKey: 'oranges' },
        },
      ],
    });
    await bridge.applyEntered;
    const state = useEditorStore.getState();
    state.applyEditTransaction({
      baseAdjustmentRevision: 0,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [{ patch: { contrast: 14 }, type: 'patch-adjustments' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'intervening-bundle-edit',
    });
    bridge.releaseApply();

    await expect(pending).rejects.toThrow('agent_tool_transaction.stale_revision:0:1');
    const after = useEditorStore.getState();
    expect(after.adjustments.contrast).toBe(14);
    expect(after.adjustments.exposure).toBe(0);
    expect(after.adjustments.hsl.oranges).toEqual(INITIAL_ADJUSTMENTS.hsl.oranges);
    expect(after.history).toHaveLength(2);
    expect(after.lastEditApplicationReceipt?.transactionId).toBe('intervening-bundle-edit');
  });

  test('rejects source and session drift before bundle publication', () => {
    const state = useEditorStore.getState();
    const identity = captureAgentToolCommitIdentity(state);
    if (identity === null) throw new Error('Expected bundle identity.');
    const next = { ...state.adjustments, exposure: 0.3 };
    expect(() =>
      buildAgentToolEditTransaction(
        { ...state, selectedImage: { path: '/fixtures/other.ARW' } },
        identity,
        next,
        'stale-source',
      ),
    ).toThrow('agent_tool_transaction.stale_source');
    expect(() =>
      buildAgentToolEditTransaction(
        { ...state, imageSession: { id: 'other-session' } },
        identity,
        next,
        'stale-session',
      ),
    ).toThrow('agent_tool_transaction.stale_session');
  });
});
