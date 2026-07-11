import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { setAgentMediumPreviewAttachmentRendererForTest } from '../../../src/utils/agent/context/agentMediumPreviewAttachmentRuntime';
import {
  AGENT_SELECTED_IMAGE_MODEL_TOOL_ALLOWLIST,
  type AgentSelectedImageModelTransport,
  type AgentSelectedImageModelTurnRequest,
  replayAgentSelectedImageModelToolLoop,
  runAgentSelectedImageModelToolLoop,
} from '../../../src/utils/agent/session/agentSelectedImageModelToolLoop';

const fixturePath = new URL('../../../docs/baseline/render/rapidraw-vite-empty-root-2026-06-10.jpg', import.meta.url);
const bins = Array.from({ length: 256 }, () => 3);

const mediumJpeg = async (): Promise<Uint8Array> => {
  const result = new Uint8Array(await readFile(fixturePath));
  for (let index = 0; index + 8 < result.length; index += 1) {
    if (result[index] !== 0xff || result[index + 1] !== 0xc0) continue;
    result[index + 5] = 0x04;
    result[index + 6] = 0x00;
    result[index + 7] = 0x06;
    result[index + 8] = 0x00;
    return result;
  }
  throw new Error('JPEG fixture has no SOF segment.');
};

const seedEditor = () =>
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    finalPreviewUrl: 'blob:model-loop-before',
    histogram: {
      [ActiveChannel.Blue]: { color: '#00f', data: bins },
      [ActiveChannel.Green]: { color: '#0f0', data: bins },
      [ActiveChannel.Luma]: { color: '#fff', data: bins },
      [ActiveChannel.Red]: { color: '#f00', data: bins },
    },
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: {
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:raw',
      path: '/fixtures/alaska/DSC_5017.ARW',
      thumbnailUrl: 'blob:thumb',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });

const mutationSnapshot = () => {
  const state = useEditorStore.getState();
  return JSON.stringify({
    adjustments: state.adjustments,
    finalPreviewUrl: state.finalPreviewUrl,
    history: state.history,
    historyIndex: state.historyIndex,
    lastBasicToneCommand: state.lastBasicToneCommand,
    selectedImage: state.selectedImage,
    uncroppedAdjustedPreviewUrl: state.uncroppedAdjustedPreviewUrl,
  });
};

class TwoTurnModel implements AgentSelectedImageModelTransport {
  readonly requests: AgentSelectedImageModelTurnRequest[] = [];

  async runTurn(request: AgentSelectedImageModelTurnRequest) {
    this.requests.push(request);
    return {
      modelId: 'fake-model-v1',
      modelTurnId: `model-turn-${request.turn}`,
      output:
        request.turn === 1
          ? {
              decision: 'call_tool',
              tool: {
                arguments: { patch: { exposure: 0.25, highlights: -12 } },
                callId: 'model-call-1',
                name: 'proposal_render',
              },
            }
          : { decision: 'finalize_proposal', proposalId: request.lineageHead?.proposalId },
      provider: 'deterministic-test-only',
      providerVersion: '1',
    };
  }
}

describe('selected-image model-to-typed-tool proposal loop', () => {
  beforeEach(async () => {
    seedEditor();
    const bytes = await mediumJpeg();
    setAgentMediumPreviewAttachmentRendererForTest(async () => new Uint8Array(bytes));
  });

  afterEach(() => setAgentMediumPreviewAttachmentRendererForTest(undefined));

  test('runs a real two-turn typed proposal and seals only the verified lineage head without mutation', async () => {
    const before = mutationSnapshot();
    const model = new TwoTurnModel();
    const result = await runAgentSelectedImageModelToolLoop(
      {
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
        modelId: 'fake-model-v1',
        operationId: 'issue-5017-two-turn',
        prompt: 'Lift the Alaska foreground while protecting snow highlights.',
        requestId: 'issue-5017-two-turn',
        schemaVersion: 1,
        sessionId: 'issue-5017-two-turn',
      },
      model,
    );

    expect(result.state).toBe('approval_required');
    expect(result.stopReason).toBeUndefined();
    expect(result.budget).toMatchObject({ toolCalls: 3, turns: 2 });
    expect(result.lineage).toHaveLength(1);
    expect(result.lineage[0]).toMatchObject({ proposalId: result.sealedProposalId, state: 'sealed' });
    expect(result.audit.map((event) => event.state)).toEqual([
      'acquiring_context',
      'model_running',
      'proposal_ready',
      'model_running',
    ]);
    expect(model.requests[0]?.attachment?.dataUrl).toStartWith('data:image/jpeg;base64,');
    expect(model.requests[1]?.attachment?.dataUrl).toStartWith('data:image/jpeg;base64,');
    expect(model.requests[1]?.lineageHead?.proposalId).toBe(result.sealedProposalId);
    expect(mutationSnapshot()).toBe(before);
    expect(AGENT_SELECTED_IMAGE_MODEL_TOOL_ALLOWLIST).not.toContain('rawengine.agent.adjustments.apply');
    expect(AGENT_SELECTED_IMAGE_MODEL_TOOL_ALLOWLIST).not.toContain('rawengine.agent.history.rollback');
    const requestsBeforeReplay = model.requests.length;
    expect(replayAgentSelectedImageModelToolLoop(result)).toMatchObject({
      sealedProposalId: result.sealedProposalId,
      state: 'approval_required',
    });
    expect(model.requests).toHaveLength(requestsBeforeReplay);
  });

  test('fails closed on malformed model output without mutating editor state', async () => {
    const before = mutationSnapshot();
    const result = await runAgentSelectedImageModelToolLoop(
      {
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
        modelId: 'fake-model-v1',
        operationId: 'issue-5017-malformed',
        prompt: 'Edit this image.',
        requestId: 'issue-5017-malformed',
        schemaVersion: 1,
        sessionId: 'issue-5017-malformed',
      },
      {
        runTurn: async () => ({
          modelId: 'fake',
          modelTurnId: 'bad-turn',
          output: { decision: 'call_tool', tool: { name: 'rawengine.agent.adjustments.apply' } },
          provider: 'fake',
          providerVersion: '1',
        }),
      },
    );

    expect(result.state).toBe('failed');
    expect(result.stopReason).toContain('Invalid input');
    expect(mutationSnapshot()).toBe(before);
  });
});
