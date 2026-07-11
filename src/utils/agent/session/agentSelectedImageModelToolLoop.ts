import {
  RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
  type RawEngineAgentSelectedImageProposalReceiptV1,
  rawEngineAgentSelectedImageProposalRenderCommandV1Schema,
} from '../../../../packages/rawengine-schema/src/agentSelectedImageProposalSchemas';
import { buildAgentImageContextSnapshot } from '../context/agentImageContextSnapshot';
import {
  RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
  rawEngineImageGetPreviewAttachmentResponseSchema,
  releaseRawEngineImagePreviewAttachment,
} from '../context/agentReadOnlyAppServerTools';
import {
  agentSelectedImageProposalRuntime,
  verifyAgentSelectedImageProposalReceipt,
} from '../context/agentSelectedImageProposalRuntime';
import {
  AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME,
  agentToneAdjustmentDryRunResponseSchema,
} from '../tools/agentToneAdjustmentTool';
import {
  type AgentSelectedImageModelOutput,
  type AgentSelectedImageModelToolLoopRequest,
  type AgentSelectedImageModelToolLoopResult,
  agentSelectedImageModelOutputSchema,
  agentSelectedImageModelToolLoopRequestSchema,
  agentSelectedImageModelToolLoopResultSchema,
} from './agentSelectedImageModelToolSchemas';
import {
  addAgentSelectedImageProposalIteration,
  createAgentSelectedImageProposalLineage,
  transitionAgentSelectedImageProposalIteration,
} from './agentSelectedImageProposalLineage';
import { createAgentTypedToolExecutionContext, dispatchAgentTypedEditorTool } from './agentTypedToolDispatch';

export const AGENT_SELECTED_IMAGE_MODEL_TOOL_ALLOWLIST = [
  AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME,
  RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
] as const;

export interface AgentSelectedImageModelTurnRequest {
  attachment?: { contentHash: string; dataUrl: string; height: number; width: number };
  deadlineAt: string;
  expectedOutput: 'agent_selected_image_model_output_v1';
  lineageHead?: { proposalId: string; receiptHash: string };
  prompt: string;
  reasoningTier: 'none' | 'minimal' | 'low' | 'light' | 'medium' | 'high' | 'xhigh';
  sessionId: string;
  turn: number;
}

export interface AgentSelectedImageModelTurnResponse {
  modelId: string;
  modelTurnId: string;
  output: unknown;
  provider: string;
  providerVersion: string;
}

export interface AgentSelectedImageModelTransport {
  close?: () => Promise<void> | void;
  runTurn: (
    request: AgentSelectedImageModelTurnRequest,
    signal: AbortSignal,
  ) => Promise<AgentSelectedImageModelTurnResponse>;
}

type LineageEntry = AgentSelectedImageModelToolLoopResult['lineage'][number];
type LoopState = AgentSelectedImageModelToolLoopResult['state'];

const activeSessions = new Map<string, AbortController>();

const hash = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const proposalArtifactFromInitial = (
  attachment: ReturnType<typeof rawEngineImageGetPreviewAttachmentResponseSchema.parse>['receipt']['attachment'],
) => ({
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

const withDeadline = async <Value>(
  task: (signal: AbortSignal) => Promise<Value>,
  parentSignal: AbortSignal,
  deadlineAt: number,
): Promise<Value> => {
  if (parentSignal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (deadlineAt <= Date.now()) throw new DOMException('Timed out', 'TimeoutError');
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
    deadlineAt - Date.now(),
  );
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timeout);
    parentSignal.removeEventListener('abort', abort);
  }
};

const terminalForError = (error: unknown): { reason: string; state: LoopState } => {
  if (error instanceof DOMException && error.name === 'AbortError') return { reason: 'cancelled', state: 'cancelled' };
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return { reason: 'deadline_exceeded', state: 'timed_out' };
  const message = error instanceof Error ? error.message : 'unknown_failure';
  if (/stale|revision|selected image|identity/iu.test(message))
    return { reason: message, state: 'stale_recovery_required' };
  return { reason: message, state: 'failed' };
};

export const cancelAgentSelectedImageModelToolLoop = (sessionId: string): boolean => {
  const controller = activeSessions.get(sessionId);
  controller?.abort(new DOMException('Cancelled', 'AbortError'));
  return controller !== undefined;
};

export const replayAgentSelectedImageModelToolLoop = (
  record: unknown,
): Pick<
  AgentSelectedImageModelToolLoopResult,
  'budget' | 'lineage' | 'proposalLineage' | 'sealedProposalId' | 'sessionId' | 'state'
> => {
  const parsed = agentSelectedImageModelToolLoopResultSchema.parse(record);
  if (parsed.state === 'approval_required') {
    const head = parsed.lineage.at(-1);
    if (head?.state !== 'sealed' || head.proposalId !== parsed.sealedProposalId) {
      throw new Error('Model-tool replay rejected a missing or stale sealed lineage head.');
    }
    const authoritativeHead = parsed.proposalLineage.iterations.find(
      (iteration) => iteration.iterationId === parsed.proposalLineage.sealedIterationId,
    );
    if (authoritativeHead?.proposalId !== parsed.sealedProposalId || authoritativeHead.state !== 'sealed') {
      throw new Error('Model-tool replay rejected an invalid authoritative sealed lineage head.');
    }
  }
  return structuredClone({
    budget: parsed.budget,
    lineage: parsed.lineage,
    proposalLineage: parsed.proposalLineage,
    ...(parsed.sealedProposalId === undefined ? {} : { sealedProposalId: parsed.sealedProposalId }),
    sessionId: parsed.sessionId,
    state: parsed.state,
  });
};

export const runAgentSelectedImageModelToolLoop = async (
  request: AgentSelectedImageModelToolLoopRequest,
  transport: AgentSelectedImageModelTransport,
): Promise<AgentSelectedImageModelToolLoopResult> => {
  const parsed = agentSelectedImageModelToolLoopRequestSchema.parse(request);
  const existing = activeSessions.get(parsed.sessionId);
  if (existing !== undefined) {
    return agentSelectedImageModelToolLoopResultSchema.parse({
      audit: [],
      budget: { maxToolCalls: 2 * parsed.budget.maxTurns + 2, previewBytes: 0, toolCalls: 0, turns: 0 },
      lineage: [],
      model: { id: parsed.modelId, provider: 'unstarted', transport: 'codex_app_server', version: 'unstarted' },
      proposalLineage: createAgentSelectedImageProposalLineage({
        lineageId: `lineage:${parsed.sessionId}`,
        sessionId: parsed.sessionId,
      }),
      sessionId: parsed.sessionId,
      state: 'busy',
      stopReason: 'session_already_active',
    });
  }

  const controller = new AbortController();
  activeSessions.set(parsed.sessionId, controller);
  const absoluteDeadline = Date.parse(parsed.deadlineAt);
  const audit: AgentSelectedImageModelToolLoopResult['audit'] = [];
  const lineage: LineageEntry[] = [];
  const maxToolCalls = 2 * parsed.budget.maxTurns + 2;
  let previewBytes = 0;
  let toolCalls = 0;
  let turns = 0;
  let head: RawEngineAgentSelectedImageProposalReceiptV1 | undefined;
  let approval: AgentSelectedImageModelToolLoopResult['approval'];
  let initialArtifactId: string | undefined;
  let model = { id: parsed.modelId, provider: 'unknown', transport: 'codex_app_server' as const, version: 'unknown' };
  let state: LoopState = 'queued';
  let stopReason: string | undefined;
  const baseline = buildAgentImageContextSnapshot();
  let proposalLineage = createAgentSelectedImageProposalLineage({
    lineageId: `lineage:${parsed.sessionId}`,
    sessionId: parsed.sessionId,
  });

  const record = async (input: Omit<AgentSelectedImageModelToolLoopResult['audit'][number], 'timestamp'>) => {
    audit.push({ ...input, timestamp: new Date().toISOString() });
  };
  const assertBaseline = () => {
    const current = buildAgentImageContextSnapshot();
    if (
      current.activeImagePath !== baseline.activeImagePath ||
      current.graphRevision !== baseline.graphRevision ||
      current.initialPreview.recipeHash !== baseline.initialPreview.recipeHash ||
      current.initialPreview.renderHash !== baseline.initialPreview.renderHash
    )
      throw new Error('Selected image or editor revision became stale during proposal iteration.');
  };

  try {
    state = 'acquiring_context';
    const contextStarted = Date.now();
    const contextCallId = `${parsed.requestId}:initial-preview`;
    const initial = rawEngineImageGetPreviewAttachmentResponseSchema.parse(
      await withDeadline(
        (signal) =>
          dispatchAgentTypedEditorTool({
            args: { expectedRecipeHash: baseline.initialPreview.recipeHash, requestId: contextCallId },
            context: createAgentTypedToolExecutionContext({
              arguments: { expectedRecipeHash: baseline.initialPreview.recipeHash },
              callId: contextCallId,
              deadlineMs: Math.min(parsed.budget.toolTimeoutMs, absoluteDeadline - Date.now()),
              requestId: contextCallId,
              sessionId: parsed.sessionId,
            }),
            signal,
            toolName: RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
          }),
        controller.signal,
        Math.min(absoluteDeadline, Date.now() + parsed.budget.toolTimeoutMs),
      ),
    );
    toolCalls += 1;
    initialArtifactId = initial.attachment.attachment.artifactId;
    previewBytes += initial.attachment.attachment.byteLength;
    if (
      initial.attachment.attachment.byteLength > parsed.budget.maxPreviewBytes ||
      previewBytes > parsed.budget.maxAggregatePreviewBytes
    ) {
      throw new Error('Preview byte budget exceeded.');
    }
    await record({
      callId: contextCallId,
      durationMs: Date.now() - contextStarted,
      receiptHash: initial.receipt.attachment.contentHash,
      state,
      turn: 0,
    });

    let nextAttachment: AgentSelectedImageModelTurnRequest['attachment'] = {
      contentHash: initial.attachment.attachment.contentHash,
      dataUrl: `data:${initial.attachment.attachment.mediaType};base64,${initial.attachment.payloadBase64}`,
      height: initial.attachment.attachment.dimensions.height,
      width: initial.attachment.attachment.dimensions.width,
    };

    for (let turn = 1; turn <= parsed.budget.maxTurns; turn += 1) {
      assertBaseline();
      turns = turn;
      state = 'model_running';
      const modelRequest: AgentSelectedImageModelTurnRequest = {
        ...(nextAttachment === undefined ? {} : { attachment: nextAttachment }),
        deadlineAt: new Date(Math.min(absoluteDeadline, Date.now() + parsed.budget.modelTimeoutMs)).toISOString(),
        expectedOutput: 'agent_selected_image_model_output_v1',
        ...(head === undefined ? {} : { lineageHead: { proposalId: head.proposalId, receiptHash: head.receiptHash } }),
        prompt:
          turn === 1
            ? parsed.prompt
            : 'Review the verified proposal preview. Refine it with proposal_render or finalize the exact current proposalId.',
        reasoningTier: parsed.reasoningTier,
        sessionId: parsed.sessionId,
        turn,
      };
      const modelStarted = Date.now();
      const response = await withDeadline(
        (signal) => transport.runTurn(modelRequest, signal),
        controller.signal,
        Math.min(absoluteDeadline, Date.now() + parsed.budget.modelTimeoutMs),
      );
      model = {
        id: response.modelId,
        provider: response.provider,
        transport: 'codex_app_server',
        version: response.providerVersion,
      };
      const output: AgentSelectedImageModelOutput = agentSelectedImageModelOutputSchema.parse(response.output);
      await record({
        durationMs: Date.now() - modelStarted,
        modelTurnId: response.modelTurnId,
        requestDigest: await hash(modelRequest),
        responseDigest: await hash(output),
        state,
        turn,
      });

      if (output.decision === 'clarification_required') {
        state = 'clarification_required';
        stopReason = 'model_requested_clarification';
        break;
      }
      if (output.decision === 'stop') {
        state = 'failed';
        stopReason = output.reason;
        break;
      }
      if (output.decision === 'finalize_proposal') {
        if (head === undefined || output.proposalId !== head.proposalId)
          throw new Error('Model attempted to finalize a stale or unknown proposal.');
        const ready = await agentSelectedImageProposalRuntime.ensureReady(head.proposalId);
        if (ready?.status !== 'ready' || ready.receiptHash !== head.receiptHash)
          throw new Error('Current proposal receipt is no longer ready.');
        const currentHead = lineage.at(-1);
        if (currentHead === undefined) throw new Error('Proposal lineage head is missing.');
        const authoritativeHead = proposalLineage.iterations.at(-1);
        if (authoritativeHead === undefined || authoritativeHead.proposalId !== head.proposalId) {
          throw new Error('Authoritative proposal lineage head is missing.');
        }
        proposalLineage = transitionAgentSelectedImageProposalIteration(
          proposalLineage,
          authoritativeHead.iterationId,
          'sealed',
          { expectedEpoch: proposalLineage.epoch },
        );
        lineage[lineage.length - 1] = { ...currentHead, state: 'sealed' };
        state = 'approval_required';
        break;
      }

      if (toolCalls + 2 > maxToolCalls) throw new Error('Typed tool-call budget exceeded.');
      state = 'tool_running';
      const toolStarted = Date.now();
      const parentCallId = head?.lineage.callId;
      const dryRunCallId = `${output.tool.callId}:dry-run`;
      const common = {
        adjustments: output.tool.arguments.patch,
        expectedGraphRevision: baseline.graphRevision,
        expectedRecipeHash: baseline.initialPreview.recipeHash,
        operationId: parsed.operationId,
        sessionId: parsed.sessionId,
      };
      const dryRun = agentToneAdjustmentDryRunResponseSchema.parse(
        await withDeadline(
          (signal) =>
            dispatchAgentTypedEditorTool({
              args: { ...common, requestId: dryRunCallId },
              context: createAgentTypedToolExecutionContext({
                arguments: common,
                callId: dryRunCallId,
                deadlineMs: Math.min(parsed.budget.toolTimeoutMs, absoluteDeadline - Date.now()),
                ...(parentCallId === undefined ? {} : { parentCallId }),
                requestId: dryRunCallId,
                sessionId: parsed.sessionId,
              }),
              signal,
              toolName: AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME,
            }),
          controller.signal,
          Math.min(absoluteDeadline, Date.now() + parsed.budget.toolTimeoutMs),
        ),
      );
      approval = {
        adjustments: output.tool.arguments.patch,
        dryRunPlanHash: dryRun.dryRunPlanHash,
        dryRunPlanId: dryRun.dryRunPlanId,
        operationId: parsed.operationId,
        sourceGraphRevision: dryRun.sourceGraphRevision,
      };
      toolCalls += 1;
      const renderCallId = output.tool.callId;
      const idempotencyKey = `${parsed.sessionId}:${turn}:${await hash(output.tool.arguments)}`;
      const renderCommand = rawEngineAgentSelectedImageProposalRenderCommandV1Schema.parse({
        basePreview: proposalArtifactFromInitial(initial.receipt.attachment),
        cancellationId: `cancel:${renderCallId}`,
        commandType: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
        deadlineAt: new Date(Math.min(absoluteDeadline, Date.now() + parsed.budget.toolTimeoutMs)).toISOString(),
        dryRun: true,
        dryRunPlan: {
          planHash: dryRun.dryRunPlanHash,
          planId: dryRun.dryRunPlanId,
          predictedGraphRevision: dryRun.predictedGraphRevision,
        },
        edit: { kind: 'basic_tone_v1', patch: output.tool.arguments.patch },
        expectedGraphRevision: baseline.graphRevision,
        expectedRecipeHash: baseline.initialPreview.recipeHash,
        expectedRenderHash: baseline.initialPreview.renderHash,
        expectedSelectedImagePath: baseline.activeImagePath,
        idempotencyKey,
        lineage: { callId: renderCallId, ...(parentCallId === undefined ? {} : { parentCallId }) },
        operationId: parsed.operationId,
        requestedPreview: { longEdgePx: 1536, maxBytes: 8 * 1024 * 1024, quality: 0.86 },
        requestId: `${parsed.requestId}:render:${turn}`,
        sessionId: parsed.sessionId,
      });
      const render = await withDeadline(
        (signal) =>
          dispatchAgentTypedEditorTool({
            args: renderCommand,
            cleanupResult: (late) => {
              void agentSelectedImageProposalRuntime.release(late.proposalId, 'cancelled');
            },
            context: createAgentTypedToolExecutionContext({
              arguments: renderCommand,
              callId: renderCallId,
              deadlineMs: Math.min(parsed.budget.toolTimeoutMs, absoluteDeadline - Date.now()),
              ...(parentCallId === undefined ? {} : { parentCallId }),
              requestId: `${parsed.requestId}:render:${turn}`,
              sessionId: parsed.sessionId,
            }),
            signal,
            toolName: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
          }),
        controller.signal,
        Math.min(absoluteDeadline, Date.now() + parsed.budget.toolTimeoutMs),
      );
      toolCalls += 1;
      if (
        render.status !== 'ready' ||
        !(await verifyAgentSelectedImageProposalReceipt(render)) ||
        render.artifacts === undefined
      )
        throw new Error('Proposal renderer returned an unverified receipt.');
      const renderBytes = render.artifacts.after.byteLength;
      previewBytes += renderBytes;
      if (renderBytes > parsed.budget.maxPreviewBytes || previewBytes > parsed.budget.maxAggregatePreviewBytes)
        throw new Error('Preview byte budget exceeded.');
      if (head !== undefined) {
        const priorHead = lineage.at(-1);
        if (priorHead === undefined) throw new Error('Proposal lineage head is missing.');
        lineage[lineage.length - 1] = { ...priorHead, state: 'superseded' };
        await agentSelectedImageProposalRuntime.release(head.proposalId, 'superseded');
      }
      head = render;
      const priorIteration = proposalLineage.iterations.at(-1);
      const iterationId = `${proposalLineage.lineageId}:iteration:${turn}`;
      proposalLineage = addAgentSelectedImageProposalIteration(proposalLineage, {
        afterPreviewArtifactId: render.artifacts.after.artifactId,
        afterPreviewContentHash: render.artifacts.after.contentHash,
        baseGraphRevision: render.base.graphRevision,
        basePreviewArtifactId: render.base.previewArtifactId,
        basePreviewContentHash: render.base.previewContentHash,
        baseRecipeHash: render.base.recipeHash,
        beforePreviewArtifactId: render.artifacts.before.artifactId,
        beforePreviewContentHash: render.artifacts.before.contentHash,
        cleanupStatus: 'not_required',
        createdAt: render.createdAt,
        expiresAt: render.expiresAt,
        initiatingTurnId: response.modelTurnId,
        iterationId,
        lineageId: proposalLineage.lineageId,
        ordinal: proposalLineage.iterations.length + 1,
        ...(priorIteration === undefined
          ? {}
          : { parentIterationId: priorIteration.iterationId, parentProposalId: priorIteration.proposalId }),
        proposalHash: render.proposalHash,
        proposalId: render.proposalId,
        proposalSchemaVersion: render.schemaVersion,
        schemaVersion: 1,
        selectedImageId: render.base.selectedImageId,
        sessionId: parsed.sessionId,
        state: 'draft',
        toolCalls: [
          { callId: dryRunCallId, ...(parentCallId === undefined ? {} : { parentCallId }), type: 'preview_acquire' },
          { callId: renderCallId, ...(parentCallId === undefined ? {} : { parentCallId }), type: 'proposal_render' },
        ],
      });
      proposalLineage = transitionAgentSelectedImageProposalIteration(proposalLineage, iterationId, 'rendering', {
        expectedEpoch: proposalLineage.epoch,
        now: render.createdAt,
      });
      proposalLineage = transitionAgentSelectedImageProposalIteration(proposalLineage, iterationId, 'ready', {
        expectedEpoch: proposalLineage.epoch,
        now: render.createdAt,
      });
      lineage.push({
        epoch: lineage.length + 1,
        ...(parentCallId === undefined ? {} : { parentProposalId: lineage.at(-1)?.proposalId }),
        proposalId: render.proposalId,
        receiptHash: render.receiptHash,
        state: 'ready',
      });
      state = 'proposal_ready';
      await record({
        callId: renderCallId,
        durationMs: Date.now() - toolStarted,
        modelTurnId: response.modelTurnId,
        ...(parentCallId === undefined ? {} : { parentCallId }),
        proposalId: render.proposalId,
        receiptHash: render.receiptHash,
        state,
        toolName: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
        turn,
      });
      const dataUrl = agentSelectedImageProposalRuntime.getPreviewUrl(render.proposalId, 'after');
      if (dataUrl === undefined) throw new Error('Verified proposal preview was unavailable for refinement.');
      nextAttachment = {
        contentHash: render.artifacts.after.contentHash,
        dataUrl,
        height: render.artifacts.after.dimensions.height,
        width: render.artifacts.after.dimensions.width,
      };
    }
    if (state !== 'approval_required' && state !== 'clarification_required' && state !== 'failed') {
      state = 'max_turns_reached';
      stopReason = 'max_turns_reached';
    }
  } catch (error) {
    ({ reason: stopReason, state } = terminalForError(error));
  } finally {
    if (initialArtifactId !== undefined) releaseRawEngineImagePreviewAttachment(initialArtifactId);
    if (state !== 'approval_required' && head !== undefined)
      await agentSelectedImageProposalRuntime.release(
        head.proposalId,
        state === 'cancelled' ? 'cancelled' : state === 'timed_out' ? 'timed_out' : 'released',
      );
    await transport.close?.();
    if (activeSessions.get(parsed.sessionId) === controller) activeSessions.delete(parsed.sessionId);
  }

  return agentSelectedImageModelToolLoopResultSchema.parse({
    ...(state === 'approval_required' && approval !== undefined ? { approval } : {}),
    audit,
    budget: { maxToolCalls, previewBytes, toolCalls, turns },
    lineage,
    model,
    proposalLineage,
    ...(state === 'approval_required' && head !== undefined ? { sealedProposalId: head.proposalId } : {}),
    sessionId: parsed.sessionId,
    state,
    ...(stopReason === undefined ? {} : { stopReason }),
  });
};
