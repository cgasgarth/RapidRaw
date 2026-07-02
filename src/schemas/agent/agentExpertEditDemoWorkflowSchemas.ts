import { z } from 'zod';

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const legacyRuntimeApplyProofStatus = ['runtime', 'apply_demo'].join('_');

const toolStepSchema = z
  .object({
    commandId: z.string().trim().min(1),
    commandType: z.string().trim().min(1),
    contentHash: hashSchema,
    dryRun: z.boolean(),
    graphRevision: z.string().trim().min(1),
    mutates: z.boolean(),
    status: z.enum(['completed', 'rejected']),
    toolName: z.string().trim().min(1),
  })
  .strict();

export const agentExpertEditDemoWorkflowSchema = z
  .object({
    approval: z
      .object({
        acceptedDryRunCommandId: z.string().trim().min(1),
        approvalClass: z.literal('edit_apply'),
        approvalId: z.string().trim().min(1),
        state: z.literal('approved'),
      })
      .strict(),
    apply: toolStepSchema.extend({
      changedNodeIds: z.array(z.string().trim().min(1)).min(1),
      undoRevision: z.string().trim().min(1),
    }),
    audit: z
      .object({
        eventCount: z.number().int().min(3),
        rejectedApplyBeforeDryRun: z.literal(true),
        timeline: z
          .array(
            z
              .object({
                dryRun: z.boolean(),
                eventId: z.string().trim().min(1),
                mutates: z.boolean(),
                status: z.enum(['completed', 'rejected']),
              })
              .strict(),
          )
          .min(3),
      })
      .strict(),
    beforeAfter: z
      .object({
        afterArtifactId: z.string().trim().min(1),
        afterGraphRevision: z.string().trim().min(1),
        afterPreviewDataUrl: z.string().startsWith('data:image/svg+xml;base64,'),
        beforeArtifactId: z.string().trim().min(1),
        beforeGraphRevision: z.string().trim().min(1),
        beforePreviewDataUrl: z.string().startsWith('data:image/svg+xml;base64,'),
        exportArtifactId: z.string().trim().min(1),
        noOverwritePolicy: z.literal('never_overwrite_original'),
        virtualCopyId: z.string().trim().min(1),
      })
      .strict(),
    dryRun: toolStepSchema.extend({
      parameterDiffPaths: z.array(z.string().trim().min(1)).min(1),
      previewArtifactId: z.string().trim().min(1),
    }),
    evidence: z
      .object({
        htmlPath: z.literal('docs/validation/proofs/agent/agent-expert-edit-demo-workflow-2026-06-21.html'),
        reportHash: hashSchema,
        reportPath: z.literal('docs/validation/proofs/agent/agent-expert-edit-demo-workflow-2026-06-21.json'),
      })
      .strict(),
    inspect: z
      .object({
        imagePath: z.string().trim().endsWith('.NEF'),
        projectTool: z.literal('rawengine.local.toolRegistry.query'),
        rawFamily: z.literal('nikon_nef_private_style_fixture'),
        toolCount: z.number().int().positive(),
        virtualCopyId: z.string().trim().min(1),
      })
      .strict(),
    issue: z.literal(3022),
    limits: z.array(z.string().trim().min(1)).min(1),
    plan: z
      .object({
        assistantPlan: z.string().trim().min(1),
        deterministicProvider: z.literal(true),
        userPrompt: z.string().trim().min(1),
      })
      .strict(),
    proofStatus: z.preprocess(
      (value) => (value === legacyRuntimeApplyProofStatus ? 'runtime_apply_ready' : value),
      z.literal('runtime_apply_ready'),
    ),
    runtimeWorkflow: z
      .object({
        api: z.literal('runAgentColorEditWorkflowV1'),
        applyAuditEventId: z.string().trim().min(1),
        dryRunAuditEventId: z.string().trim().min(1),
      })
      .strict(),
    refs: z.tuple([z.literal('#2983'), z.literal('#3022')]),
    validationMode: z.literal('agent_expert_edit_demo_workflow'),
  })
  .strict();

export type AgentExpertEditDemoWorkflow = z.infer<typeof agentExpertEditDemoWorkflowSchema>;
