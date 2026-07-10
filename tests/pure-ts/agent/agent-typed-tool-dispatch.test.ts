import { beforeEach, describe, expect, test } from 'bun:test';

import { RawEngineAppServerHostToolName } from '../../../src/schemas/agent/agentRuntimeSchemas';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import { AGENT_STATE_GET_TOOL_NAME } from '../../../src/utils/agent/context/agentReadOnlyAppServerTools';
import {
  createAgentTypedToolExecutionContext,
  dispatchAgentTypedEditorTool,
} from '../../../src/utils/agent/session/agentTypedToolDispatch';
import {
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  buildAgentAdjustmentsApplyApproval,
} from '../../../src/utils/agent/tools/agentAdjustmentApplyTool';
import {
  cancelRawEngineAppServerTypedDispatch,
  handleRawEngineAppServerHostRequestAsync,
} from '../../../src/utils/rawEngineAppServerHost';

const selectedPath = '/fixtures/pure-ts/agent-typed-dispatch/DSC_5027.ARW';
const sessionId = 'agent-typed-dispatch-test';

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    finalPreviewUrl: 'blob:agent-typed-dispatch-before',
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: {
      exif: { ISO: '100', LensModel: 'FE 24-70mm F2.8 GM II' },
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:agent-typed-dispatch-original',
      path: selectedPath,
      thumbnailUrl: 'blob:agent-typed-dispatch-thumb',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

const dispatch = (request: unknown) => handleRawEngineAppServerHostRequestAsync(request);

const buildDryRunArguments = (requestId: string) => {
  const snapshot = buildAgentImageContextSnapshot();
  return {
    adjustments: { exposure: 0.2 },
    expectedGraphRevision: snapshot.graphRevision,
    expectedRecipeHash: snapshot.initialPreview.recipeHash,
    operationId: 'agent-typed-dispatch-operation',
    requestId,
    sessionId,
  };
};

describe('typed selected-image app-server dispatch', () => {
  beforeEach(() => {
    seedEditor();
  });

  test('returns a parsed mapped response and lineage envelope for the selected image', async () => {
    const requestId = 'typed-state';
    const result = await dispatchAgentTypedEditorTool({
      args: { requestId },
      context: createAgentTypedToolExecutionContext({ arguments: { requestId }, requestId, sessionId }),
      toolName: AGENT_STATE_GET_TOOL_NAME,
    });

    expect(result.toolName).toBe(AGENT_STATE_GET_TOOL_NAME);
    expect(result.requestId).toBe(requestId);
  });

  test('rejects unknown, stale, expired, and cancelled calls before editor mutation', async () => {
    const initialHistoryIndex = useEditorStore.getState().historyIndex;
    const staleArguments = buildDryRunArguments('typed-stale');
    const staleContext = createAgentTypedToolExecutionContext({
      arguments: staleArguments,
      requestId: staleArguments.requestId,
      sessionId,
    });
    const staleResponse = await dispatch({
      arguments: staleArguments,
      executionContext: {
        ...staleContext,
        expected: { graphRevision: 'history_99', recipeHash: staleArguments.expectedRecipeHash },
      },
      requestId: staleArguments.requestId,
      runtimeToolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    });
    expect(staleResponse.execution?.outcome).toBe('stale');

    const expiredArguments = buildDryRunArguments('typed-expired');
    const expiredContext = createAgentTypedToolExecutionContext({
      arguments: expiredArguments,
      requestId: expiredArguments.requestId,
      sessionId,
    });
    const expiredResponse = await dispatch({
      arguments: expiredArguments,
      executionContext: { ...expiredContext, deadlineAt: '2020-01-01T00:00:00.000Z' },
      requestId: expiredArguments.requestId,
      runtimeToolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    });
    expect(expiredResponse.execution?.outcome).toBe('timed_out');

    const cancelledArguments = buildDryRunArguments('typed-cancelled');
    const cancelledContext = createAgentTypedToolExecutionContext({
      arguments: cancelledArguments,
      requestId: cancelledArguments.requestId,
      sessionId,
    });
    cancelRawEngineAppServerTypedDispatch(cancelledContext.cancellationId);
    const cancelledResponse = await dispatch({
      arguments: cancelledArguments,
      executionContext: cancelledContext,
      requestId: cancelledArguments.requestId,
      runtimeToolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    });
    expect(cancelledResponse.execution?.outcome).toBe('cancelled');

    const unknownResponse = await dispatch({
      arguments: { requestId: 'typed-unknown' },
      executionContext: createAgentTypedToolExecutionContext({
        arguments: { requestId: 'typed-unknown' },
        requestId: 'typed-unknown',
        sessionId,
      }),
      requestId: 'typed-unknown',
      runtimeToolName: 'rawengine.agent.unknown.tool',
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    });
    expect(unknownResponse.execution?.outcome).toBe('rejected');
    expect(useEditorStore.getState().historyIndex).toBe(initialHistoryIndex);
  });

  test('reuses terminal idempotency receipts and rejects a concurrent selected-image mutation', async () => {
    const dryRunArguments = buildDryRunArguments('typed-dry-run');
    const dryRun = await dispatchAgentTypedEditorTool({
      args: dryRunArguments,
      context: createAgentTypedToolExecutionContext({
        arguments: dryRunArguments,
        requestId: dryRunArguments.requestId,
        sessionId,
      }),
      toolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
    });
    const applyArguments = {
      acceptedPlanHash: dryRun.dryRunPlanHash,
      acceptedPlanId: dryRun.dryRunPlanId,
      adjustments: dryRunArguments.adjustments,
      approval: buildAgentAdjustmentsApplyApproval({
        approvalId: 'typed-apply-approval',
        dryRun,
        expectedRecipeHash: dryRunArguments.expectedRecipeHash,
        sessionId,
      }),
      expectedGraphRevision: dryRun.sourceGraphRevision,
      expectedRecipeHash: dryRunArguments.expectedRecipeHash,
      operationId: dryRunArguments.operationId,
      requestId: 'typed-apply',
      sessionId,
    };
    const firstContext = {
      ...createAgentTypedToolExecutionContext({
        arguments: applyArguments,
        requestId: applyArguments.requestId,
        sessionId,
      }),
      idempotencyKey: 'typed-apply-idempotency',
    };
    const secondArguments = { ...applyArguments, requestId: 'typed-apply-concurrent' };
    const secondContext = {
      ...createAgentTypedToolExecutionContext({
        arguments: secondArguments,
        requestId: secondArguments.requestId,
        sessionId,
      }),
      idempotencyKey: 'typed-apply-concurrent-idempotency',
    };
    const [first, concurrent] = await Promise.all([
      dispatch({
        arguments: applyArguments,
        executionContext: firstContext,
        requestId: applyArguments.requestId,
        runtimeToolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
        toolName: RawEngineAppServerHostToolName.DispatchTool,
      }),
      dispatch({
        arguments: secondArguments,
        executionContext: secondContext,
        requestId: secondArguments.requestId,
        runtimeToolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
        toolName: RawEngineAppServerHostToolName.DispatchTool,
      }),
    ]);
    expect(first.execution?.outcome).toBe('completed');
    expect(concurrent.execution?.outcome).toBe('rejected');
    expect(concurrent.message).toContain('busy');
    expect(useEditorStore.getState().historyIndex).toBe(1);

    const duplicate = await dispatch({
      arguments: applyArguments,
      executionContext: firstContext,
      requestId: applyArguments.requestId,
      runtimeToolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    });
    expect(duplicate).toEqual(first);
    expect(useEditorStore.getState().historyIndex).toBe(1);
  });
});
