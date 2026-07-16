import { beforeEach, describe, expect, test } from 'bun:test';

import type {
  EditCommandBusContext,
  EditCommandDispatchResult,
} from '../../../packages/rawengine-schema/src/editCommandBus';
import { RawEngineLocalAppServerBridge } from '../../../packages/rawengine-schema/src/localAppServerBridge';
import {
  ActorKind,
  ApprovalClass,
  type EditGraphParameterPatchOperationV1,
  editGraphCommandEnvelopeV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  applyEditGraphCommandToLiveEditor,
  dryRunEditGraphCommandInLiveEditor,
} from '../../../src/utils/agent/session/agentLiveEditGraph';
import {
  buildAgentEditGraphEditTransaction,
  captureAgentEditGraphCommitIdentity,
} from '../../../src/utils/agentEditGraphEditTransaction';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixtures/agent-editgraph.ARW';
const session = createEditorImageSession({ generation: 31, path: sourcePath, source: 'cache' });
const operations: EditGraphParameterPatchOperationV1[] = [
  {
    nodeId: 'legacy_adjustments',
    op: 'replace',
    path: '/adjustments/exposure',
    previousValue: INITIAL_ADJUSTMENTS.exposure,
    value: 0.6,
  },
];

const buildCommand = (dryRun: boolean, commandOperations: readonly EditGraphParameterPatchOperationV1[] = operations) =>
  editGraphCommandEnvelopeV1Schema.parse({
    actor: { id: 'test-agent', kind: ActorKind.Agent, sessionId: 'agent-editgraph-test' },
    approval: dryRun
      ? { approvalClass: ApprovalClass.PreviewOnly, reason: 'Preview.', state: 'not_required' }
      : { approvalClass: ApprovalClass.EditApply, reason: 'Apply.', state: 'approved' },
    commandId: dryRun ? 'agent-editgraph-dry-run' : 'agent-editgraph-apply',
    commandType: 'editGraph.applyParameterPatch',
    correlationId: 'agent-editgraph-correlation',
    dryRun,
    expectedGraphRevision: 'history_0',
    idempotencyKey: `agent-editgraph:${dryRun ? 'dry-run' : 'apply'}`,
    parameters: { label: 'Agent EditGraph transaction test', operations: commandOperations },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { imagePath: sourcePath, kind: 'image' },
  });

class DeferredEditGraphBridge extends RawEngineLocalAppServerBridge {
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

describe('agent EditGraph EditTransaction bridge', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:agent-editgraph-current',
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
      history: [editDocumentV2],
    });
  });

  test('rejects an async completion after an intervening editor revision', async () => {
    const bridge = new DeferredEditGraphBridge();
    await dryRunEditGraphCommandInLiveEditor(buildCommand(true), bridge, 'editgraph-dry-run');
    const pending = applyEditGraphCommandToLiveEditor(buildCommand(false), bridge, 'editgraph-delayed-apply');
    await bridge.applyEntered;

    const state = useEditorStore.getState();
    state.applyEditTransaction({
      baseAdjustmentRevision: state.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [{ nodeType: 'scene_global_color_tone', patch: { contrast: 12 }, type: 'patch-edit-document-node' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'intervening-manual-edit',
    });
    bridge.releaseApply();

    await expect(pending).rejects.toThrow('agent_editgraph_transaction.stale_revision:0:1');
    const after = useEditorStore.getState();
    expect(after.editDocumentV2.nodes['scene_global_color_tone']!.params['contrast']).toBe(12);
    expect(after.editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0);
    expect(after.history).toHaveLength(2);
    expect(after.lastEditApplicationReceipt?.transactionId).toBe('intervening-manual-edit');
  });

  test('preserves exact no-ops without history, receipt, or preview invalidation', async () => {
    const noOpOperations: EditGraphParameterPatchOperationV1[] = [
      {
        nodeId: 'legacy_adjustments',
        op: 'replace',
        path: '/adjustments/exposure',
        previousValue: INITIAL_ADJUSTMENTS.exposure,
        value: INITIAL_ADJUSTMENTS.exposure,
      },
    ];
    const bridge = new RawEngineLocalAppServerBridge();
    const dryRun = buildCommand(true, noOpOperations);
    const apply = buildCommand(false, noOpOperations);
    await dryRunEditGraphCommandInLiveEditor(dryRun, bridge, 'editgraph-no-op-dry-run');
    await applyEditGraphCommandToLiveEditor(apply, bridge, 'editgraph-no-op-apply');

    const state = useEditorStore.getState();
    expect(state.adjustmentRevision).toBe(0);
    expect(state.history).toHaveLength(1);
    expect(state.lastEditApplicationReceipt).toBeNull();
    expect(state.finalPreviewUrl).toBe('blob:agent-editgraph-current');
  });

  test('rejects source and image-session changes before constructing a commit', () => {
    const state = useEditorStore.getState();
    const identity = captureAgentEditGraphCommitIdentity(state);
    if (identity === null) throw new Error('Expected seeded EditGraph identity.');
    const nextAdjustments = { ...state.editDocumentV2, exposure: 0.6 };
    expect(() =>
      buildAgentEditGraphEditTransaction(
        { ...state, selectedImage: { path: '/fixtures/other.ARW' } },
        identity,
        nextAdjustments,
        'stale-source',
      ),
    ).toThrow(`agent_editgraph_transaction.stale_source:${sourcePath}:/fixtures/other.ARW`);
    expect(() =>
      buildAgentEditGraphEditTransaction(
        { ...state, imageSession: { id: 'other-session' } },
        identity,
        nextAdjustments,
        'stale-session',
      ),
    ).toThrow(`agent_editgraph_transaction.stale_session:${session.id}:other-session`);
  });

  test('applies through fallback session authority and rejects same-path reopen identities', async () => {
    useEditorStore.setState({ imageSession: null, imageSessionId: 71 });
    const bridge = new RawEngineLocalAppServerBridge();
    await dryRunEditGraphCommandInLiveEditor(buildCommand(true), bridge, 'fallback-editgraph-dry-run');
    await applyEditGraphCommandToLiveEditor(buildCommand(false), bridge, 'fallback-editgraph-apply');

    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 1,
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: 'editor-image-session:71',
        transactionId: 'agent-editgraph-apply',
      },
    });
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.6);
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0);

    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      imageSessionId: 81,
      editDocumentV2: useEditorStore.getState().editDocumentV2,
      history: [useEditorStore.getState().editDocumentV2],
      historyIndex: 0,
    });
    const fallbackState = useEditorStore.getState();
    const identity = captureAgentEditGraphCommitIdentity(fallbackState);
    if (identity === null) throw new Error('Expected fallback EditGraph identity.');
    expect(identity.imageSessionId).toBe('editor-image-session:81');
    expect(() =>
      buildAgentEditGraphEditTransaction(
        { ...fallbackState, imageSessionId: 83 },
        identity,
        { ...fallbackState.editDocumentV2, exposure: 0.2 },
        'stale-reopened-a',
      ),
    ).toThrow('agent_editgraph_transaction.stale_session:editor-image-session:81:editor-image-session:83');
  });
});
