import { beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import {
  createRawEngineLocalAppServerBridge,
  RawEngineLocalAppServerCommandType,
} from '../../../packages/rawengine-schema/src/localAppServerBridge';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import {
  AgentMediumPreviewAttachmentManager,
  sha256ForAgentPreviewBytes,
} from '../../../src/utils/agent/context/agentMediumPreviewAttachmentRuntime';
import { createAgentSelectedImageProposalRuntime } from '../../../src/utils/agent/context/agentSelectedImageProposalRuntime';
import { dryRunAgentToneAdjustment } from '../../../src/utils/agent/tools/agentToneAdjustmentTool';

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

const buildProposalCommand = async () => {
  const snapshot = buildAgentImageContextSnapshot();
  const dryRun = await dryRunAgentToneAdjustment({
    adjustments: { exposure: 0.32, shadows: 14 },
    expectedGraphRevision: snapshot.graphRevision,
    expectedRecipeHash: snapshot.initialPreview.recipeHash,
    operationId: 'issue-5014-proposal',
    requestId: 'issue-5014-proposal-dry-run',
    sessionId: 'issue-5014-proposal',
  });
  const baseContentHash = await sha256ForAgentPreviewBytes(
    new TextEncoder().encode(`${snapshot.initialPreview.artifactId}:${snapshot.initialPreview.renderHash}`),
  );

  return {
    basePreview: { artifactId: snapshot.initialPreview.artifactId, contentHash: baseContentHash },
    cancellationId: 'issue-5014-proposal-cancel',
    commandType: RawEngineLocalAppServerCommandType.AgentSelectedImageProposalRender,
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    dryRun: true,
    dryRunPlan: {
      planHash: dryRun.dryRunPlanHash,
      planId: dryRun.dryRunPlanId,
      predictedGraphRevision: dryRun.predictedGraphRevision,
    },
    edit: { kind: 'basic_tone_v1' as const, patch: { exposure: 0.32, shadows: 14 } },
    expectedGraphRevision: snapshot.graphRevision,
    expectedRecipeHash: snapshot.initialPreview.recipeHash,
    expectedRenderHash: snapshot.initialPreview.renderHash,
    expectedSelectedImagePath: snapshot.activeImagePath,
    idempotencyKey: 'issue-5014-proposal-idempotency',
    lineage: { callId: 'issue-5014-proposal-render', parentCallId: 'issue-5014-proposal-dry-run' },
    operationId: 'issue-5014-proposal',
    requestedPreview: { longEdgePx: 1536 as const, maxBytes: (8 * 1024 * 1024) as const, quality: 0.86 as const },
    requestId: 'issue-5014-proposal-render',
    sessionId: 'issue-5014-proposal',
  };
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

  test('renders an immutable selected-image proposal through the local bridge', async () => {
    const command = await buildProposalCommand();
    let renderedExposure: number | undefined;
    const runtime = createAgentSelectedImageProposalRuntime({
      renderPreview: async ({ adjustments }) => {
        renderedExposure = (adjustments as typeof INITIAL_ADJUSTMENTS).exposure;
        return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      },
    });
    const adjustmentsBefore = useEditorStore.getState().adjustments;
    const historyBefore = useEditorStore.getState().history;
    const bridge = createRawEngineLocalAppServerBridge({ runSelectedImageProposalRender: runtime.render });

    const response = await bridge.dispatch(command);

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.message);
    expect(response.result).toMatchObject({
      artifacts: {
        after: { contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
        before: { artifactId: command.basePreview.artifactId, contentHash: command.basePreview.contentHash },
      },
      status: 'ready',
    });
    expect(renderedExposure).toBe(0.32);
    expect(useEditorStore.getState().adjustments).toBe(adjustmentsBefore);
    expect(useEditorStore.getState().history).toBe(historyBefore);
    expect(useEditorStore.getState().historyIndex).toBe(0);
  });

  test('stores proposal pixels as revision-bound attachment artifacts and releases them', async () => {
    const command = await buildProposalCommand();
    const previewBytes = withMediumPreviewDimensions(new Uint8Array(await readFile(fixturePath)));
    let renderedExposure: number | undefined;
    const manager = new AgentMediumPreviewAttachmentManager(async ({ adjustments }) => {
      renderedExposure = (adjustments as typeof INITIAL_ADJUSTMENTS).exposure;
      return previewBytes;
    });
    const runtime = createAgentSelectedImageProposalRuntime({ manager });

    const receipt = await runtime.render(command);
    const afterArtifactId = receipt.artifacts?.after.artifactId;

    expect(receipt).toMatchObject({
      artifacts: { after: { artifactId: expect.stringMatching(/^agent-medium-preview:/) } },
      status: 'ready',
    });
    expect(renderedExposure).toBe(0.32);
    if (afterArtifactId === undefined) throw new Error('Expected an after proposal artifact.');
    expect(manager.getAuditAttachment(afterArtifactId)?.revision).toMatchObject({
      graphRevision: receipt.dryRunPlan.predictedGraphRevision,
      recipeHash: receipt.render.proposedRecipeHash,
      renderHash: receipt.render.proposedRenderHash,
    });

    runtime.release(receipt.proposalId, 'released');

    expect(manager.getAuditAttachment(afterArtifactId)?.lifecycle.status).toBe('released');
  });

  test('marks a proposal stale when editor identity changes before delivery without applying it', async () => {
    const command = await buildProposalCommand();
    let resolveRender: ((bytes: Uint8Array) => void) | undefined;
    const runtime = createAgentSelectedImageProposalRuntime({
      renderPreview: () =>
        new Promise<Uint8Array>((resolve) => {
          resolveRender = resolve;
        }),
    });
    const historyBefore = useEditorStore.getState().history;
    const rendering = runtime.render(command);
    await waitForRenderStart(() => resolveRender);
    useEditorStore.setState((state) => ({ adjustments: { ...state.adjustments, exposure: 0.1 } }));
    resolveRender?.(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));

    const receipt = await rendering;

    expect(receipt).toMatchObject({ status: 'stale', warnings: [expect.stringContaining('changed')] });
    expect(receipt.artifacts).toBeUndefined();
    expect(useEditorStore.getState().history).toBe(historyBefore);
    expect(useEditorStore.getState().historyIndex).toBe(0);
  });

  test('invalidates a ready proposal when a later editor change makes its base stale', async () => {
    const command = await buildProposalCommand();
    const runtime = createAgentSelectedImageProposalRuntime({
      renderPreview: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    const receipt = await runtime.render(command);
    const historyBefore = useEditorStore.getState().history;

    useEditorStore.setState((state) => ({ adjustments: { ...state.adjustments, exposure: 0.1 } }));

    expect(runtime.getReceipt(receipt.proposalId)).toMatchObject({ cleanupState: 'stale', status: 'stale' });
    expect(runtime.getPreviewUrl(receipt.proposalId)).toBeUndefined();
    expect(useEditorStore.getState().history).toBe(historyBefore);
    expect(useEditorStore.getState().historyIndex).toBe(0);
  });

  test('cancels an in-flight proposal before delivery without applying it', async () => {
    const command = await buildProposalCommand();
    let resolveRender: ((bytes: Uint8Array) => void) | undefined;
    const runtime = createAgentSelectedImageProposalRuntime({
      renderPreview: () =>
        new Promise<Uint8Array>((resolve) => {
          resolveRender = resolve;
        }),
    });
    const historyBefore = useEditorStore.getState().history;
    const rendering = runtime.render(command);
    await waitForRenderStart(() => resolveRender);
    runtime.cancel(command.cancellationId);
    resolveRender?.(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));

    const receipt = await rendering;

    expect(receipt).toMatchObject({ cleanupState: 'cancelled', status: 'cancelled' });
    expect(useEditorStore.getState().history).toBe(historyBefore);
    expect(useEditorStore.getState().historyIndex).toBe(0);
  });
});
