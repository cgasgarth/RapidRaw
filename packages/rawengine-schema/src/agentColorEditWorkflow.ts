import { z } from 'zod';
import type { EditCommandBusContext } from './editCommandBus.js';
import {
  type RawEngineLocalAppServerAuditEventV1,
  RawEngineLocalAppServerBridge,
  rawEngineLocalAppServerAuditEventV1Schema,
} from './localAppServerBridge.js';
import {
  type ToneColorCommandEnvelopeV1,
  toneColorCommandEnvelopeV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from './rawEngineSchemas.js';

export const agentColorEditWorkflowSummaryV1Schema = z
  .object({
    apply: z
      .object({
        appliedGraphRevision: z.string().trim().min(1),
        changedNodeIds: z.array(z.string().trim().min(1)).min(1),
        commandId: z.string().trim().min(1),
        commandType: z.string().trim().min(1),
        mutates: z.literal(true),
        toolName: z.literal('tonecolor.apply_command'),
        undoRevision: z.string().trim().min(1),
      })
      .strict(),
    audit: z
      .object({
        applyEventId: z.string().trim().min(1),
        dryRunEventId: z.string().trim().min(1),
        eventCount: z.number().int().min(2),
      })
      .strict(),
    dryRun: z
      .object({
        commandId: z.string().trim().min(1),
        commandType: z.string().trim().min(1),
        mutates: z.literal(false),
        parameterDiffPaths: z.array(z.string().trim().min(1)).min(1),
        predictedGraphRevision: z.string().trim().min(1),
        sourceGraphRevision: z.string().trim().min(1),
        toolName: z.literal('tonecolor.dry_run_command'),
      })
      .strict(),
    target: z
      .object({
        imagePath: z.string().trim().min(1).optional(),
        kind: z.string().trim().min(1),
        virtualCopyId: z.string().trim().min(1).nullable().optional(),
      })
      .strict(),
  })
  .strict();

export type AgentColorEditWorkflowSummaryV1 = z.infer<typeof agentColorEditWorkflowSummaryV1Schema>;

export interface AgentColorEditWorkflowRequestV1 {
  applyCommand: ToneColorCommandEnvelopeV1;
  bridge?: RawEngineLocalAppServerBridge;
  context?: EditCommandBusContext;
  dryRunCommand: ToneColorCommandEnvelopeV1;
}

export const runAgentColorEditWorkflowV1 = async ({
  applyCommand,
  bridge = createDefaultAgentColorBridge(),
  context,
  dryRunCommand,
}: AgentColorEditWorkflowRequestV1): Promise<AgentColorEditWorkflowSummaryV1> => {
  const parsedDryRunCommand = toneColorCommandEnvelopeV1Schema.parse(dryRunCommand);
  const parsedApplyCommand = toneColorCommandEnvelopeV1Schema.parse(applyCommand);
  if (!parsedDryRunCommand.dryRun) throw new Error('Agent color workflow requires a dry-run command first.');
  if (parsedApplyCommand.dryRun) throw new Error('Agent color workflow apply command must mutate.');
  if (parsedDryRunCommand.commandType !== parsedApplyCommand.commandType) {
    throw new Error('Agent color workflow apply command must match the dry-run command type.');
  }
  if (JSON.stringify(parsedDryRunCommand.target) !== JSON.stringify(parsedApplyCommand.target)) {
    throw new Error('Agent color workflow apply command must target the dry-run image or virtual copy.');
  }

  const dryRunDispatch = await bridge.dispatch(parsedDryRunCommand, context);
  if (!dryRunDispatch.ok) throw new Error(`Agent color workflow dry-run failed: ${dryRunDispatch.message}`);
  const dryRun = toneColorDryRunResultV1Schema.parse(dryRunDispatch.result);

  const applyDispatch = await bridge.dispatch(parsedApplyCommand, context);
  if (!applyDispatch.ok) throw new Error(`Agent color workflow apply failed: ${applyDispatch.message}`);
  const apply = toneColorMutationResultV1Schema.parse(applyDispatch.result);

  const auditEvents = bridge.listAuditEvents().map((event) => rawEngineLocalAppServerAuditEventV1Schema.parse(event));
  const dryRunAudit = requireAuditEvent(auditEvents, parsedDryRunCommand.commandId);
  const applyAudit = requireAuditEvent(auditEvents, parsedApplyCommand.commandId);

  return agentColorEditWorkflowSummaryV1Schema.parse({
    apply: {
      appliedGraphRevision: apply.appliedGraphRevision,
      changedNodeIds: apply.changedNodeIds,
      commandId: apply.commandId,
      commandType: apply.commandType,
      mutates: apply.mutates,
      toolName: 'tonecolor.apply_command',
      undoRevision: apply.undoRevision,
    },
    audit: {
      applyEventId: applyAudit.eventId,
      dryRunEventId: dryRunAudit.eventId,
      eventCount: auditEvents.length,
    },
    dryRun: {
      commandId: dryRun.commandId,
      commandType: dryRun.commandType,
      mutates: dryRun.mutates,
      parameterDiffPaths: dryRun.parameterDiff.map((diff) => diff.path),
      predictedGraphRevision: dryRun.predictedGraphRevision,
      sourceGraphRevision: dryRun.sourceGraphRevision,
      toolName: 'tonecolor.dry_run_command',
    },
    target: parsedApplyCommand.target,
  });
};

const createDefaultAgentColorBridge = (): RawEngineLocalAppServerBridge => new RawEngineLocalAppServerBridge();

const requireAuditEvent = (
  auditEvents: RawEngineLocalAppServerAuditEventV1[],
  commandId: string,
): RawEngineLocalAppServerAuditEventV1 => {
  const event = auditEvents.find((candidate) => candidate.commandId === commandId);
  if (event === undefined) throw new Error(`Agent color workflow missing audit event for ${commandId}.`);
  if (event.status !== 'completed') throw new Error(`Agent color workflow audit event failed for ${commandId}.`);
  return event;
};
