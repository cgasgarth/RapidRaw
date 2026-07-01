import { z } from 'zod';

import {
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  type AgentPreviewRenderResponse,
  agentPreviewRenderResponseSchema,
} from '../context/agentReadOnlyAppServerTools';
import {
  AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME,
  AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME,
  type AgentToneAdjustmentApplyResponse,
  type AgentToneAdjustmentDryRunResponse,
  agentToneAdjustmentApplyResponseSchema,
  agentToneAdjustmentDryRunResponseSchema,
} from '../tools/agentToneAdjustmentTool';

export const agentIterativeEditTimelinePhaseSchema = z.enum(['preview', 'dry_run', 'apply', 'preview_after']);
export const agentIterativeEditTimelineStatusSchema = z.enum(['succeeded', 'failed', 'cancelled', 'skipped']);

const linkedAuditIdsSchema = z
  .object({
    auditEventIds: z.array(z.string().trim().min(1)),
    cancellationId: z.string().trim().min(1).optional(),
    commandId: z.string().trim().min(1).optional(),
    dryRunPlanHash: z.string().trim().min(1).optional(),
    dryRunPlanId: z.string().trim().min(1).optional(),
    previewArtifactId: z.string().trim().min(1).optional(),
    previewRef: z.string().trim().min(1).optional(),
    replayStepId: z.string().trim().min(1),
  })
  .strict();

export const agentIterativeEditTimelineEventSchema = z
  .object({
    acceptedPlanHash: z.string().trim().min(1).optional(),
    acceptedPlanId: z.string().trim().min(1).optional(),
    eventId: z.string().trim().min(1),
    expectedGraphRevision: z.string().trim().min(1).optional(),
    graphRevisionAfter: z.string().trim().min(1).optional(),
    graphRevisionBefore: z.string().trim().min(1).optional(),
    linked: linkedAuditIdsSchema,
    nextEventId: z.string().trim().min(1).nullable(),
    occurredAtIso: z.iso.datetime(),
    phase: agentIterativeEditTimelinePhaseSchema,
    previousEventId: z.string().trim().min(1).nullable(),
    renderHash: z.string().trim().min(1).optional(),
    requestId: z.string().trim().min(1),
    status: agentIterativeEditTimelineStatusSchema,
    toolName: z.string().trim().min(1),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict();

export const agentIterativeEditAuditTimelineSchema = z
  .object({
    deterministicReplayHash: z.string().trim().min(1),
    eventCount: z.number().int().positive(),
    events: z.array(agentIterativeEditTimelineEventSchema).min(1),
    operationId: z.string().trim().min(1),
    replayId: z.string().trim().min(1),
    schemaVersion: z.literal(1),
    sessionId: z.string().trim().min(1),
  })
  .strict()
  .superRefine((timeline, context) => {
    if (timeline.eventCount !== timeline.events.length) {
      context.addIssue({
        code: 'custom',
        message: 'Timeline eventCount must match events length.',
        path: ['eventCount'],
      });
    }

    const expectedPhases = ['preview', 'dry_run', 'apply', 'preview_after'] as const;
    const actualPhases = timeline.events.map((event) => event.phase);
    if (
      expectedPhases.some((phase, index) => actualPhases[index] !== phase) ||
      actualPhases.length !== expectedPhases.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Timeline must order preview -> dry_run -> apply -> preview_after.',
        path: ['events'],
      });
    }

    for (const [index, event] of timeline.events.entries()) {
      const previous = timeline.events[index - 1];
      const next = timeline.events[index + 1];
      if ((previous?.eventId ?? null) !== event.previousEventId) {
        context.addIssue({
          code: 'custom',
          message: 'Timeline previousEventId is not linked.',
          path: ['events', index],
        });
      }
      if ((next?.eventId ?? null) !== event.nextEventId) {
        context.addIssue({ code: 'custom', message: 'Timeline nextEventId is not linked.', path: ['events', index] });
      }
    }

    const dryRun = timeline.events.find((event) => event.phase === 'dry_run');
    const apply = timeline.events.find((event) => event.phase === 'apply');
    if (
      dryRun?.linked.dryRunPlanId === undefined ||
      dryRun.linked.dryRunPlanHash === undefined ||
      apply?.acceptedPlanId !== dryRun.linked.dryRunPlanId ||
      apply.acceptedPlanHash !== dryRun.linked.dryRunPlanHash
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Apply event must link to the dry-run plan identity.',
        path: ['events'],
      });
    }
  });

export type AgentIterativeEditAuditTimeline = z.infer<typeof agentIterativeEditAuditTimelineSchema>;
export type AgentIterativeEditTimelineEvent = z.infer<typeof agentIterativeEditTimelineEventSchema>;

export interface BuildAgentToneAdjustmentTimelineInput {
  apply: AgentToneAdjustmentApplyResponse;
  dryRun: AgentToneAdjustmentDryRunResponse;
  initialPreview: AgentPreviewRenderResponse;
  occurredAtIso?: readonly [string, string, string, string];
  operationId: string;
  previewAfter: AgentPreviewRenderResponse;
  sessionId: string;
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const stableAgentTimelineReplayHash = (value: unknown): string => {
  const input = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const defaultOccurredAtIso = [
  '2026-06-24T10:00:00.000Z',
  '2026-06-24T10:00:01.000Z',
  '2026-06-24T10:00:02.000Z',
  '2026-06-24T10:00:03.000Z',
] as const;

export const buildAgentToneAdjustmentAuditTimeline = ({
  apply,
  dryRun,
  initialPreview,
  occurredAtIso = defaultOccurredAtIso,
  operationId,
  previewAfter,
  sessionId,
}: BuildAgentToneAdjustmentTimelineInput): AgentIterativeEditAuditTimeline => {
  const parsedInitialPreview = agentPreviewRenderResponseSchema.parse(initialPreview);
  const parsedDryRun = agentToneAdjustmentDryRunResponseSchema.parse(dryRun);
  const parsedApply = agentToneAdjustmentApplyResponseSchema.parse(apply);
  const parsedPreviewAfter = agentPreviewRenderResponseSchema.parse(previewAfter);

  const eventIds = [
    `timeline:${operationId}:preview`,
    `timeline:${operationId}:dry_run`,
    `timeline:${operationId}:apply`,
    `timeline:${operationId}:preview_after`,
  ] as const;
  const [previewEventId, dryRunEventId, applyEventId, previewAfterEventId] = eventIds;
  const [previewOccurredAtIso, dryRunOccurredAtIso, applyOccurredAtIso, previewAfterOccurredAtIso] = occurredAtIso;
  const replayId = `agent_iterative_edit_timeline:${sessionId}:${operationId}`;
  const replayStepId = (phase: string) => `${replayId}:${phase}`;
  const events: AgentIterativeEditTimelineEvent[] = [
    {
      eventId: previewEventId,
      graphRevisionBefore: parsedDryRun.sourceGraphRevision,
      linked: {
        auditEventIds: [],
        previewArtifactId: parsedInitialPreview.preview.artifactId,
        previewRef: parsedInitialPreview.preview.previewRef,
        replayStepId: replayStepId('preview'),
      },
      nextEventId: dryRunEventId,
      occurredAtIso: previewOccurredAtIso,
      phase: 'preview',
      previousEventId: null,
      renderHash: parsedInitialPreview.preview.renderHash,
      requestId: parsedInitialPreview.requestId,
      status: 'succeeded',
      toolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
      warnings: [],
    },
    {
      eventId: dryRunEventId,
      expectedGraphRevision: parsedDryRun.receipt.expectedGraphRevision,
      graphRevisionAfter: parsedDryRun.predictedGraphRevision,
      graphRevisionBefore: parsedDryRun.sourceGraphRevision,
      linked: {
        auditEventIds: parsedDryRun.auditEventIds,
        commandId: parsedDryRun.commandId,
        dryRunPlanHash: parsedDryRun.dryRunPlanHash,
        dryRunPlanId: parsedDryRun.dryRunPlanId,
        previewArtifactId: parsedDryRun.previewAfter.artifactId,
        previewRef: parsedDryRun.previewAfter.previewRef,
        replayStepId: replayStepId('dry_run'),
      },
      nextEventId: applyEventId,
      occurredAtIso: dryRunOccurredAtIso,
      phase: 'dry_run',
      previousEventId: previewEventId,
      renderHash: parsedDryRun.previewAfter.renderHash,
      requestId: parsedDryRun.requestId,
      status: 'succeeded',
      toolName: AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME,
      warnings: parsedDryRun.warnings,
    },
    {
      acceptedPlanHash: parsedApply.receipt.acceptedPlanHash,
      acceptedPlanId: parsedApply.receipt.acceptedPlanId,
      eventId: applyEventId,
      expectedGraphRevision: parsedApply.receipt.expectedGraphRevision,
      graphRevisionAfter: parsedApply.appliedGraphRevision,
      graphRevisionBefore: parsedApply.undoGraphRevision,
      linked: {
        auditEventIds: parsedApply.auditEventIds,
        commandId: parsedApply.previewAfter.previewRef.split('/').at(-2) ?? parsedApply.requestId,
        dryRunPlanHash: parsedApply.receipt.acceptedPlanHash,
        dryRunPlanId: parsedApply.receipt.acceptedPlanId,
        previewArtifactId: parsedApply.previewAfter.artifactId,
        previewRef: parsedApply.previewAfter.previewRef,
        replayStepId: replayStepId('apply'),
      },
      nextEventId: previewAfterEventId,
      occurredAtIso: applyOccurredAtIso,
      phase: 'apply',
      previousEventId: dryRunEventId,
      renderHash: parsedApply.afterPreviewHash,
      requestId: parsedApply.requestId,
      status: 'succeeded',
      toolName: AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME,
      warnings: parsedApply.warnings,
    },
    {
      eventId: previewAfterEventId,
      graphRevisionAfter: parsedApply.appliedGraphRevision,
      graphRevisionBefore: parsedApply.undoGraphRevision,
      linked: {
        auditEventIds: parsedApply.auditEventIds,
        previewArtifactId: parsedPreviewAfter.preview.artifactId,
        previewRef: parsedPreviewAfter.preview.previewRef,
        replayStepId: replayStepId('preview_after'),
      },
      nextEventId: null,
      occurredAtIso: previewAfterOccurredAtIso,
      phase: 'preview_after',
      previousEventId: applyEventId,
      renderHash: parsedPreviewAfter.preview.renderHash,
      requestId: parsedPreviewAfter.requestId,
      status: 'succeeded',
      toolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
      warnings: parsedPreviewAfter.staleRecipeHash ? ['preview_after_recipe_hash_stale'] : [],
    },
  ];

  const replayHashInput = {
    events: events.map((event) => ({
      acceptedPlanHash: event.acceptedPlanHash,
      acceptedPlanId: event.acceptedPlanId,
      graphRevisionAfter: event.graphRevisionAfter,
      graphRevisionBefore: event.graphRevisionBefore,
      linked: event.linked,
      phase: event.phase,
      renderHash: event.renderHash,
      requestId: event.requestId,
      status: event.status,
      toolName: event.toolName,
      warnings: event.warnings,
    })),
    operationId,
    replayId,
    schemaVersion: 1,
    sessionId,
  };

  return agentIterativeEditAuditTimelineSchema.parse({
    deterministicReplayHash: stableAgentTimelineReplayHash(replayHashInput),
    eventCount: events.length,
    events,
    operationId,
    replayId,
    schemaVersion: 1,
    sessionId,
  });
};
