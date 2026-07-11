import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import {
  RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
  rawEngineAgentSelectedImageProposalRenderCommandV1Schema,
} from '../../../packages/rawengine-schema/src/agentSelectedImageProposalSchemas';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import {
  AgentMediumPreviewAttachmentManager,
  setAgentMediumPreviewAttachmentRendererForTest,
} from '../../../src/utils/agent/context/agentMediumPreviewAttachmentRuntime';
import { RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME } from '../../../src/utils/agent/context/agentReadOnlyAppServerTools';
import {
  agentSelectedImageProposalRuntime,
  createAgentSelectedImageProposalRuntime,
  verifyAgentSelectedImageProposalReceipt,
} from '../../../src/utils/agent/context/agentSelectedImageProposalRuntime';
import {
  renderAgentSelectedImageLiveSessionProposal,
  startAgentSelectedImageLiveSessionDryRun,
} from '../../../src/utils/agent/session/agentSelectedImageLiveSession';
import {
  createAgentTypedToolExecutionContext,
  dispatchAgentTypedEditorTool,
} from '../../../src/utils/agent/session/agentTypedToolDispatch';
import { dryRunAgentToneAdjustment } from '../../../src/utils/agent/tools/agentToneAdjustmentTool';
import { cancelRawEngineAppServerTypedDispatch } from '../../../src/utils/rawEngineAppServerHost';

const selectedPath = '/fixtures/pure-ts/agent-selected-image-proposal/DSC_5014.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 9 : 3));
const fixturePath = new URL('../../../docs/baseline/render/rapidraw-vite-empty-root-2026-06-10.jpg', import.meta.url);

const withMediumPreviewDimensions = (bytes: Uint8Array): Uint8Array => {
  const result = new Uint8Array(bytes);
  for (let index = 0; index + 8 < result.length; index += 1) {
    if (result[index] !== 0xff || result[index + 1] !== 0xc0) continue;
    result[index + 5] = 0x04;
    result[index + 6] = 0x00;
    result[index + 7] = 0x06;
    result[index + 8] = 0x00;
    return result;
  }
  throw new Error('JPEG fixture is missing a baseline SOF segment.');
};

const previewBytes = async (): Promise<Uint8Array> =>
  withMediumPreviewDimensions(new Uint8Array(await readFile(fixturePath)));

const previewVariant = (source: Uint8Array, marker: number): Uint8Array => {
  const result = new Uint8Array(source.byteLength + 1);
  result.set(source.subarray(0, -2));
  result[result.length - 3] = marker;
  result[result.length - 2] = 0xff;
  result[result.length - 1] = 0xd9;
  return result;
};

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    finalPreviewUrl: 'blob:agent-selected-image-proposal-before',
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
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:agent-selected-image-proposal-original',
      path: selectedPath,
      thumbnailUrl: 'blob:agent-selected-image-proposal-thumbnail',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

const snapshotMutableEditorState = () => {
  const state = useEditorStore.getState();
  return structuredClone({
    adjustments: state.adjustments,
    finalPreviewUrl: state.finalPreviewUrl,
    history: state.history,
    historyIndex: state.historyIndex,
    lastBasicToneCommand: state.lastBasicToneCommand,
    selectedImage: state.selectedImage,
    uncroppedAdjustedPreviewUrl: state.uncroppedAdjustedPreviewUrl,
  });
};

const proposalArtifactFromAttachment = (attachment: {
  accessScope: 'local_private';
  artifactId: string;
  byteLength: number;
  colorPipeline: {
    encodedProfile: 'srgb-preview';
    outputProfile: 'srgb';
    previewTransform: 'editor-preview-to-srgb-jpeg';
    workingSpace: 'rawengine-scene-linear';
  };
  contentHash: string;
  dimensions: { height: number; width: number };
  encodedFormat: 'jpeg';
  expiresAt: string;
  mediaType: 'image/jpeg';
  quality: 0.86;
  revision: { recipeHash: string; renderHash: string };
}) => ({
  accessScope: attachment.accessScope,
  artifactId: attachment.artifactId,
  byteLength: attachment.byteLength,
  colorPipeline: attachment.colorPipeline,
  contentHash: attachment.contentHash,
  dimensions: attachment.dimensions,
  encodedFormat: attachment.encodedFormat,
  expiresAt: attachment.expiresAt,
  mediaType: attachment.mediaType,
  quality: attachment.quality,
  recipeHash: attachment.revision.recipeHash,
  renderHash: attachment.revision.renderHash,
});

const buildProposalCommand = async ({
  id = 'default',
  manager,
  patch = { exposure: 0.32, shadows: 14 },
  sessionId = 'issue-5058-proposal',
}: {
  id?: string;
  manager: AgentMediumPreviewAttachmentManager;
  patch?: { exposure?: number; shadows?: number };
  sessionId?: string;
}) => {
  const snapshot = buildAgentImageContextSnapshot();
  const deadlineAt = new Date(Date.now() + 30_000).toISOString();
  const dryRun = await dryRunAgentToneAdjustment({
    adjustments: patch,
    expectedGraphRevision: snapshot.graphRevision,
    expectedRecipeHash: snapshot.initialPreview.recipeHash,
    operationId: `issue-5058-${id}`,
    requestId: `issue-5058-${id}-dry-run`,
    sessionId,
  });
  const base = await manager.acquire({ deadlineAt: Date.parse(deadlineAt), snapshot });

  return rawEngineAgentSelectedImageProposalRenderCommandV1Schema.parse({
    basePreview: proposalArtifactFromAttachment(base.attachment),
    cancellationId: `issue-5058-${id}-cancel`,
    commandType: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
    deadlineAt,
    dryRun: true,
    dryRunPlan: {
      planHash: dryRun.dryRunPlanHash,
      planId: dryRun.dryRunPlanId,
      predictedGraphRevision: dryRun.predictedGraphRevision,
    },
    edit: { kind: 'basic_tone_v1', patch },
    expectedGraphRevision: snapshot.graphRevision,
    expectedRecipeHash: snapshot.initialPreview.recipeHash,
    expectedRenderHash: snapshot.initialPreview.renderHash,
    expectedSelectedImagePath: snapshot.activeImagePath,
    idempotencyKey: `issue-5058-${id}-idempotency`,
    lineage: { callId: `issue-5058-${id}-render`, parentCallId: `issue-5058-${id}-dry-run` },
    operationId: `issue-5058-${id}`,
    requestedPreview: { longEdgePx: 1536, maxBytes: 8 * 1024 * 1024, quality: 0.86 },
    requestId: `issue-5058-${id}-render`,
    sessionId,
  });
};

const waitForRenderStart = async (getResolve: () => unknown): Promise<void> => {
  while (getResolve() === undefined) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
};

describe('agent selected-image proposal runtime', () => {
  beforeEach(() => {
    seedEditor();
  });

  afterEach(() => {
    setAgentMediumPreviewAttachmentRendererForTest(undefined);
  });

  test('renders the live-session proposal from native JPEG bytes without editor mutation', async () => {
    const source = await previewBytes();
    setAgentMediumPreviewAttachmentRendererForTest(async ({ adjustments }) =>
      adjustments === undefined ? source : previewVariant(source, 0x50),
    );
    const before = snapshotMutableEditorState();
    const draft = await startAgentSelectedImageLiveSessionDryRun({
      adjustments: { exposure: 0.32, highlights: -18, shadows: 14 },
      operationId: 'issue-5014-live-session',
      prompt: 'Brighten the selected RAW while preserving highlights.',
      requestId: 'issue-5014-live-session',
      sessionId: 'issue-5014-live-session',
    });

    const receipt = await renderAgentSelectedImageLiveSessionProposal(draft);

    expect(receipt.status).toBe('ready');
    expect(receipt.lineage).toEqual({
      callId: 'issue-5014-live-session-proposal',
      parentCallId: 'issue-5014-live-session-dry-run',
    });
    expect(receipt.dryRunPlan).toMatchObject({
      planHash: draft.dryRun.dryRunPlanHash,
      planId: draft.dryRun.dryRunPlanId,
    });
    expect(receipt.artifacts?.before.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.artifacts?.after.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.artifacts?.after.contentHash).not.toBe(receipt.artifacts?.before.contentHash);
    expect(receipt.artifacts?.before.dimensions).toEqual({ height: 1024, width: 1536 });
    expect(receipt.artifacts?.after.dimensions).toEqual({ height: 1024, width: 1536 });
    expect(await verifyAgentSelectedImageProposalReceipt(receipt)).toBe(true);
    expect(draft.proposal).toEqual(receipt);
    expect(snapshotMutableEditorState()).toEqual(before);

    await agentSelectedImageProposalRuntime.release(receipt.proposalId, 'released');
    expect((await agentSelectedImageProposalRuntime.ensureReady(receipt.proposalId))?.status).toBe('released');
  });

  test('dispatches through the app-server host and binds the comparison UI to acquired before bytes', async () => {
    const source = await previewBytes();
    setAgentMediumPreviewAttachmentRendererForTest(async ({ adjustments }) =>
      adjustments === undefined ? source : previewVariant(source, 0x31),
    );
    const snapshot = buildAgentImageContextSnapshot();
    const baseRequest = { expectedRecipeHash: snapshot.initialPreview.recipeHash, requestId: 'issue-5058-host-base' };
    const baseContext = createAgentTypedToolExecutionContext({
      arguments: baseRequest,
      callId: baseRequest.requestId,
      deadlineMs: 30_000,
      requestId: baseRequest.requestId,
      sessionId: 'issue-5058-host',
    });
    const base = await dispatchAgentTypedEditorTool({
      args: baseRequest,
      context: baseContext,
      toolName: RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
    });
    const dryRun = await dryRunAgentToneAdjustment({
      adjustments: { exposure: 0.32 },
      expectedGraphRevision: snapshot.graphRevision,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      operationId: 'issue-5058-host',
      requestId: 'issue-5058-host-dry-run',
      sessionId: 'issue-5058-host',
    });
    const proposalContext = createAgentTypedToolExecutionContext({
      arguments: {
        expectedGraphRevision: snapshot.graphRevision,
        expectedRecipeHash: snapshot.initialPreview.recipeHash,
        expectedSelectedImagePath: snapshot.activeImagePath,
      },
      callId: 'issue-5058-host-proposal',
      deadlineMs: 30_000,
      requestId: 'issue-5058-host-proposal',
      sessionId: 'issue-5058-host',
    });
    const command = rawEngineAgentSelectedImageProposalRenderCommandV1Schema.parse({
      basePreview: proposalArtifactFromAttachment(base.receipt.attachment),
      cancellationId: proposalContext.cancellationId,
      commandType: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
      deadlineAt: proposalContext.deadlineAt,
      dryRun: true,
      dryRunPlan: {
        planHash: dryRun.dryRunPlanHash,
        planId: dryRun.dryRunPlanId,
        predictedGraphRevision: dryRun.predictedGraphRevision,
      },
      edit: { kind: 'basic_tone_v1', patch: { exposure: 0.32 } },
      expectedGraphRevision: snapshot.graphRevision,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      expectedRenderHash: snapshot.initialPreview.renderHash,
      expectedSelectedImagePath: snapshot.activeImagePath,
      idempotencyKey: proposalContext.idempotencyKey,
      lineage: { callId: proposalContext.callId, parentCallId: baseContext.callId },
      operationId: 'issue-5058-host',
      requestedPreview: { longEdgePx: 1536, maxBytes: 8 * 1024 * 1024, quality: 0.86 },
      requestId: proposalContext.requestId,
      sessionId: 'issue-5058-host',
    });

    const receipt = await dispatchAgentTypedEditorTool({
      args: command,
      context: proposalContext,
      toolName: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
    });

    expect(receipt.status).toBe('ready');
    expect(receipt.artifacts?.before).toEqual(command.basePreview);
    expect(receipt.artifacts?.before.byteLength).toBe(base.receipt.attachment.byteLength);
    expect(await verifyAgentSelectedImageProposalReceipt(receipt)).toBe(true);
    const beforeUrl = agentSelectedImageProposalRuntime.getPreviewUrl(receipt.proposalId, 'before');
    const afterUrl = agentSelectedImageProposalRuntime.getPreviewUrl(receipt.proposalId, 'after');
    expect(beforeUrl).toBe(`data:image/jpeg;base64,${base.attachment.payloadBase64}`);
    expect(afterUrl).toMatch(/^data:image\/jpeg;base64,/u);
    await agentSelectedImageProposalRuntime.release(receipt.proposalId, 'released');
    const duplicateAfterRelease = await dispatchAgentTypedEditorTool({
      args: command,
      context: proposalContext,
      toolName: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
    });
    expect(duplicateAfterRelease.status).toBe('released');

    const timedOutContext = {
      ...proposalContext,
      callId: 'issue-5058-host-timeout',
      cancellationId: 'cancel-issue-5058-host-timeout',
      deadlineAt: '2020-01-01T00:00:00.000Z',
      idempotencyKey: 'idem-issue-5058-host-timeout',
      requestId: 'issue-5058-host-timeout',
    };
    const timedOut = await dispatchAgentTypedEditorTool({
      args: {
        ...command,
        cancellationId: timedOutContext.cancellationId,
        deadlineAt: timedOutContext.deadlineAt,
        idempotencyKey: timedOutContext.idempotencyKey,
        lineage: { callId: timedOutContext.callId, parentCallId: command.lineage.parentCallId },
        requestId: timedOutContext.requestId,
      },
      context: timedOutContext,
      toolName: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
    });
    expect(timedOut.status).toBe('timed_out');

    const cancelledContext = {
      ...proposalContext,
      callId: 'issue-5058-host-cancelled',
      cancellationId: 'cancel-issue-5058-host-cancelled',
      idempotencyKey: 'idem-issue-5058-host-cancelled',
      requestId: 'issue-5058-host-cancelled',
    };
    cancelRawEngineAppServerTypedDispatch(cancelledContext.cancellationId);
    const cancelled = await dispatchAgentTypedEditorTool({
      args: {
        ...command,
        cancellationId: cancelledContext.cancellationId,
        deadlineAt: cancelledContext.deadlineAt,
        idempotencyKey: cancelledContext.idempotencyKey,
        lineage: { callId: cancelledContext.callId, parentCallId: command.lineage.parentCallId },
        requestId: cancelledContext.requestId,
      },
      context: cancelledContext,
      toolName: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
    });
    expect(cancelled.status).toBe('cancelled');
  });

  test('preserves the acquired before artifact and its bytes in the receipt and comparison binding', async () => {
    const source = await previewBytes();
    const manager = new AgentMediumPreviewAttachmentManager(async ({ adjustments }) =>
      adjustments === undefined ? source : previewVariant(source, 0x32),
    );
    const command = await buildProposalCommand({ id: 'binding', manager });
    const runtime = createAgentSelectedImageProposalRuntime({ manager });

    const receipt = await runtime.render(command);
    const beforeUrl = runtime.getPreviewUrl(receipt.proposalId, 'before');
    const afterUrl = runtime.getPreviewUrl(receipt.proposalId, 'after');

    expect(receipt).toMatchObject({
      artifacts: { before: command.basePreview },
      base: { artifact: command.basePreview },
      status: 'ready',
    });
    expect(beforeUrl).toMatch(`data:${command.basePreview.mediaType};base64,`);
    expect(afterUrl).toMatch(`data:${command.basePreview.mediaType};base64,`);
    expect(beforeUrl).not.toBe(afterUrl);
    expect(await verifyAgentSelectedImageProposalReceipt(receipt)).toBe(true);
  });

  test('invalidates a receipt hash when bound evidence is tampered', async () => {
    const source = await previewBytes();
    const manager = new AgentMediumPreviewAttachmentManager(async ({ adjustments }) =>
      adjustments === undefined ? source : previewVariant(source, 0x33),
    );
    const runtime = createAgentSelectedImageProposalRuntime({ manager });
    const receipt = await runtime.render(await buildProposalCommand({ id: 'tamper', manager }));
    if (receipt.artifacts === undefined) throw new Error('Expected a ready proposal receipt.');

    expect(await verifyAgentSelectedImageProposalReceipt(receipt)).toBe(true);
    expect(
      await verifyAgentSelectedImageProposalReceipt({
        ...receipt,
        artifacts: {
          ...receipt.artifacts,
          after: { ...receipt.artifacts.after, byteLength: receipt.artifacts.after.byteLength + 1 },
        },
      }),
    ).toBe(false);
    expect(await verifyAgentSelectedImageProposalReceipt({ ...receipt, warnings: ['tampered warning'] })).toBe(false);
    expect(await verifyAgentSelectedImageProposalReceipt({ ...receipt, status: 'released' })).toBe(false);
  });

  test('returns typed timeout, failure, stale, cancellation, and release receipts without editor mutation', async () => {
    const source = await previewBytes();
    const manager = new AgentMediumPreviewAttachmentManager(async ({ adjustments }) =>
      adjustments === undefined ? source : previewVariant(source, 0x34),
    );
    const runtime = createAgentSelectedImageProposalRuntime({ manager });
    const beforeHistory = useEditorStore.getState().history;

    const timeout = await runtime.render({
      ...(await buildProposalCommand({ id: 'timeout', manager })),
      deadlineAt: '2020-01-01T00:00:00.000Z',
    });
    expect(timeout.status).toBe('timed_out');

    const failureManager = new AgentMediumPreviewAttachmentManager(async ({ adjustments }) => {
      if (adjustments !== undefined) throw new Error('Native proposal renderer failed.');
      return source;
    });
    const failure = await createAgentSelectedImageProposalRuntime({ manager: failureManager }).render(
      await buildProposalCommand({ id: 'failure', manager: failureManager }),
    );
    expect(failure.status).toBe('failed');

    const stale = await runtime.render({
      ...(await buildProposalCommand({ id: 'stale', manager })),
      expectedGraphRevision: 'history_stale',
    });
    expect(stale.status).toBe('stale');

    const releaseCommand = await buildProposalCommand({ id: 'release', manager });
    const ready = await runtime.render(releaseCommand);
    await runtime.release(ready.proposalId, 'released');
    const released = runtime.getReceipt(ready.proposalId);
    expect(released?.status).toBe('released');
    for (const receipt of [timeout, failure, stale, released]) {
      expect(receipt === undefined ? false : await verifyAgentSelectedImageProposalReceipt(receipt)).toBe(true);
    }
    expect(useEditorStore.getState().history).toBe(beforeHistory);
    expect(useEditorStore.getState().historyIndex).toBe(0);
  });

  test('cancels an in-flight proposal and returns a typed cancellation receipt', async () => {
    const source = await previewBytes();
    let resolveRender: ((bytes: Uint8Array) => void) | undefined;
    const manager = new AgentMediumPreviewAttachmentManager(({ adjustments }) =>
      adjustments === undefined
        ? Promise.resolve(source)
        : new Promise<Uint8Array>((resolve) => {
            resolveRender = resolve;
          }),
    );
    const runtime = createAgentSelectedImageProposalRuntime({ manager });
    const command = await buildProposalCommand({ id: 'cancel', manager });
    const rendering = runtime.render(command);

    await waitForRenderStart(() => resolveRender);
    await runtime.cancel(command.cancellationId);
    resolveRender?.(previewVariant(source, 0x35));

    const receipt = await rendering;
    expect(receipt.status).toBe('cancelled');
    expect(await verifyAgentSelectedImageProposalReceipt(receipt)).toBe(true);
  });

  test('supersedes concurrent work in one session and reuses duplicate idempotency receipts', async () => {
    const source = await previewBytes();
    const renderResolvers: Array<(bytes: Uint8Array) => void> = [];
    let afterRenderCount = 0;
    const manager = new AgentMediumPreviewAttachmentManager(({ adjustments }) =>
      adjustments === undefined
        ? Promise.resolve(source)
        : new Promise<Uint8Array>((resolve) => {
            afterRenderCount += 1;
            renderResolvers.push(resolve);
          }),
    );
    const runtime = createAgentSelectedImageProposalRuntime({ manager });
    const first = await buildProposalCommand({ id: 'concurrent-first', manager, sessionId: 'issue-5058-concurrent' });
    const second = await buildProposalCommand({
      id: 'concurrent-second',
      manager,
      patch: { exposure: 0.5 },
      sessionId: 'issue-5058-concurrent',
    });

    const firstRender = runtime.render(first);
    await waitForRenderStart(() => renderResolvers[0]);
    const secondRender = runtime.render(second);
    await waitForRenderStart(() => renderResolvers[1]);
    renderResolvers[0]?.(previewVariant(source, 0x36));
    renderResolvers[1]?.(previewVariant(source, 0x37));

    const [firstReceipt, secondReceipt] = await Promise.all([firstRender, secondRender]);
    expect(firstReceipt.status).toBe('superseded');
    expect(secondReceipt.status).toBe('ready');

    const duplicate = await buildProposalCommand({ id: 'duplicate', manager, sessionId: 'issue-5058-duplicate' });
    const duplicateRender = runtime.render(duplicate);
    await waitForRenderStart(() => renderResolvers[2]);
    const duplicateAgain = runtime.render(structuredClone(duplicate));
    renderResolvers[2]?.(previewVariant(source, 0x38));
    const [firstDuplicate, secondDuplicate] = await Promise.all([duplicateRender, duplicateAgain]);
    expect(afterRenderCount).toBe(3);
    expect(secondDuplicate).toEqual(firstDuplicate);
  });
});
