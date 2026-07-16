import { beforeEach, describe, expect, test } from 'bun:test';

import type {
  EditCommandBusContext,
  EditCommandDispatchResult,
} from '../../../packages/rawengine-schema/src/editCommandBus';
import { RawEngineLocalAppServerBridge } from '../../../packages/rawengine-schema/src/localAppServerBridge';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { runAgentCoreEditCommandBundle } from '../../../src/utils/agent/planning/agentCoreEditCommandBundle';
import {
  buildAgentToolEditTransaction,
  captureAgentToolCommitIdentity,
} from '../../../src/utils/agentToolEditTransaction';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

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
      this.signalEntered();
      await this.gate;
    }
    return super.dispatch<TResult>(command, context);
  }
}

describe('agent core command bundle transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:bundle-current',
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
      history: [editDocumentV2],
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
      operations: [{ nodeType: 'scene_global_color_tone', patch: { contrast: 14 }, type: 'patch-edit-document-node' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'intervening-bundle-edit',
    });
    bridge.releaseApply();

    await expect(pending).rejects.toThrow('agent_tool_transaction.stale_revision:0:1');
    const after = useEditorStore.getState();
    expect(selectEditDocumentNode(after.editDocumentV2, 'scene_global_color_tone').params['contrast']).toBe(14);
    expect(selectEditDocumentNode(after.editDocumentV2, 'scene_global_color_tone').params['exposure']).toBe(0);
    expect(selectEditDocumentNode(after.editDocumentV2, 'selective_color_mixer').params['hsl'].oranges).toEqual(
      INITIAL_ADJUSTMENTS.hsl.oranges,
    );
    expect(after.history).toHaveLength(2);
    expect(after.lastEditApplicationReceipt?.transactionId).toBe('intervening-bundle-edit');
  });

  test('rejects source and session drift before bundle publication', () => {
    const state = useEditorStore.getState();
    const identity = captureAgentToolCommitIdentity(state);
    if (identity === null) throw new Error('Expected bundle identity.');
    const operations = [
      {
        nodeType: 'scene_global_color_tone' as const,
        patch: { exposure: 0.3 },
        type: 'patch-edit-document-node' as const,
      },
    ];
    expect(() =>
      buildAgentToolEditTransaction(
        { ...state, selectedImage: { path: '/fixtures/other.ARW' } },
        identity,
        operations,
        'stale-source',
      ),
    ).toThrow('agent_tool_transaction.stale_source');
    expect(() =>
      buildAgentToolEditTransaction(
        { ...state, imageSession: { id: 'other-session' } },
        identity,
        operations,
        'stale-session',
      ),
    ).toThrow('agent_tool_transaction.stale_session');
  });

  test('publishes through fallback session authority and rejects same-path reopen identities', async () => {
    useEditorStore.setState({ imageSession: null, imageSessionId: 71 });
    const result = await runAgentCoreEditCommandBundle({
      bridge: new RawEngineLocalAppServerBridge(),
      operationId: 'fallback-core-bundle',
      sessionId: 'core-bundle-test',
      steps: [{ kind: 'basic_tone', payload: { ...INITIAL_ADJUSTMENTS, exposure: 0.4 } }],
    });
    expect(result.changedPixelCount).toBeGreaterThan(0);
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 1,
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: 'editor-image-session:71',
        transactionId: 'fallback-core-bundle_apply',
      },
    });
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'scene_global_color_tone').params['exposure'],
    ).toBe(0.4);
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'scene_global_color_tone').params['exposure'],
    ).toBe(0);

    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      imageSessionId: 81,
      editDocumentV2: useEditorStore.getState().editDocumentV2,
      history: [useEditorStore.getState().editDocumentV2],
      historyIndex: 0,
    });
    const fallbackState = useEditorStore.getState();
    const identity = captureAgentToolCommitIdentity(fallbackState);
    if (identity === null) throw new Error('Expected fallback bundle identity.');
    expect(identity.imageSessionId).toBe('editor-image-session:81');
    expect(() =>
      buildAgentToolEditTransaction(
        { ...fallbackState, imageSessionId: 83 },
        identity,
        [
          {
            nodeType: 'scene_global_color_tone',
            patch: { exposure: 0.2 },
            type: 'patch-edit-document-node',
          },
        ],
        'stale-reopened-a',
      ),
    ).toThrow('agent_tool_transaction.stale_session:editor-image-session:81:editor-image-session:83');
  });
});
