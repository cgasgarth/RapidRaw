import { z } from 'zod';

export const RAW_ENGINE_SCHEMA_VERSION = 1;

export const ActorKind = {
  Agent: 'agent',
  Batch: 'batch',
  Cli: 'cli',
  Plugin: 'plugin',
  Server: 'server',
  Test: 'test',
  Ui: 'ui',
} as const;

export const actorKindSchema = z.enum([
  ActorKind.Agent,
  ActorKind.Batch,
  ActorKind.Cli,
  ActorKind.Plugin,
  ActorKind.Server,
  ActorKind.Test,
  ActorKind.Ui,
]);

export const ApprovalClass = {
  BatchApply: 'batch_apply',
  CloudService: 'cloud_service',
  EditApply: 'edit_apply',
  ExpensiveJob: 'expensive_job',
  ExternalModel: 'external_model',
  FileMutation: 'file_mutation',
  GenerativeEdit: 'generative_edit',
  ModelSupplyChain: 'model_supply_chain',
  PreviewOnly: 'preview_only',
  SafeRead: 'safe_read',
  UnsafeImport: 'unsafe_import',
} as const;

export const approvalClassSchema = z.enum([
  ApprovalClass.SafeRead,
  ApprovalClass.PreviewOnly,
  ApprovalClass.EditApply,
  ApprovalClass.BatchApply,
  ApprovalClass.FileMutation,
  ApprovalClass.ExternalModel,
  ApprovalClass.CloudService,
  ApprovalClass.GenerativeEdit,
  ApprovalClass.ExpensiveJob,
  ApprovalClass.UnsafeImport,
  ApprovalClass.ModelSupplyChain,
]);

export const approvalStateSchema = z.enum(['not_required', 'pending', 'approved', 'denied']);

export const rawEngineActorSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: actorKindSchema,
    sessionId: z.string().trim().min(1).optional(),
  })
  .strict();

export const rawEngineTargetKindSchema = z.enum([
  'project',
  'image',
  'virtual_copy',
  'layer',
  'mask',
  'artifact',
  'roll',
  'export',
]);

export const rawEngineTargetSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    imagePath: z.string().trim().min(1).optional(),
    kind: rawEngineTargetKindSchema,
    virtualCopyId: z.string().trim().min(1).nullable().optional(),
  })
  .strict()
  .refine((target) => target.id !== undefined || target.imagePath !== undefined, {
    message: 'Target requires an id or imagePath.',
  });

export const approvalRequirementSchema = z
  .object({
    approvalClass: approvalClassSchema,
    reason: z.string().trim().min(1),
    recordId: z.string().trim().min(1).optional(),
    state: approvalStateSchema,
  })
  .strict();

export const commandEnvelopeV1Schema = z
  .object({
    actor: rawEngineActorSchema,
    approval: approvalRequirementSchema,
    commandId: z.string().trim().min(1),
    commandType: z.string().trim().min(1),
    correlationId: z.string().trim().min(1),
    dryRun: z.boolean(),
    expectedGraphRevision: z.string().trim().min(1).optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
    parameters: z.record(z.string(), z.unknown()),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    target: rawEngineTargetSchema,
  })
  .strict();

export const queryEnvelopeV1Schema = z
  .object({
    actor: rawEngineActorSchema,
    correlationId: z.string().trim().min(1),
    parameters: z.record(z.string(), z.unknown()),
    queryId: z.string().trim().min(1),
    queryType: z.string().trim().min(1),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    target: rawEngineTargetSchema,
  })
  .strict();

export const artifactHandleV1Schema = z
  .object({
    artifactId: z.string().trim().min(1),
    contentHash: z.string().trim().min(1).optional(),
    dimensions: z
      .object({
        height: z.number().int().positive(),
        width: z.number().int().positive(),
      })
      .strict()
      .optional(),
    kind: z.enum(['mask', 'preview', 'generated_patch', 'denoise_output', 'merge_output', 'export']),
    storage: z.enum(['temp_cache', 'sidecar_artifact', 'export_path']),
  })
  .strict();

export const rawEngineToolKindSchema = z.enum(['read', 'preview', 'dry_run', 'apply', 'export', 'job']);

export const rawEngineToolDefinitionV1Schema = z
  .object({
    approvalClass: approvalClassSchema,
    inputSchemaName: z.string().trim().min(1),
    mutates: z.boolean(),
    outputSchemaName: z.string().trim().min(1),
    requiresDryRun: z.boolean(),
    returnsArtifactHandles: z.boolean(),
    toolKind: rawEngineToolKindSchema,
    toolName: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/u),
  })
  .strict();

export const rawEngineToolRegistryV1Schema = z
  .object({
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    tools: z.array(rawEngineToolDefinitionV1Schema).min(1),
  })
  .strict();

export type ActorKind = z.infer<typeof actorKindSchema>;
export type ApprovalClass = z.infer<typeof approvalClassSchema>;
export type ApprovalRequirementV1 = z.infer<typeof approvalRequirementSchema>;
export type ArtifactHandleV1 = z.infer<typeof artifactHandleV1Schema>;
export type CommandEnvelopeV1 = z.infer<typeof commandEnvelopeV1Schema>;
export type QueryEnvelopeV1 = z.infer<typeof queryEnvelopeV1Schema>;
export type RawEngineActor = z.infer<typeof rawEngineActorSchema>;
export type RawEngineTarget = z.infer<typeof rawEngineTargetSchema>;
export type RawEngineToolDefinitionV1 = z.infer<typeof rawEngineToolDefinitionV1Schema>;
export type RawEngineToolRegistryV1 = z.infer<typeof rawEngineToolRegistryV1Schema>;
