import { z } from 'zod';

const rawEngineAppServerInputSchemaNamesV1 = [
  'AiEnhancementCommandEnvelopeV1',
  'AiToolCommandEnvelopeV1',
  'CommandEnvelopeV1',
  'ComputationalMergeCommandEnvelopeV1',
  'ComputationalMergeDerivedSourceOpenRequestV1',
  'DetailDeblurCommandEnvelopeV1',
  'DetailDenoiseCommandEnvelopeV1',
  'DetailEffectsCommandEnvelopeV1',
  'EditGraphCommandEnvelopeV1',
  'EditGraphSnapshotQueryV1',
  'ExportCommandEnvelopeV1',
  'LayerMaskCommandEnvelopeV1',
  'LensProfileCommandEnvelopeV1',
  'NegativeLabApplyPlanRequestV1',
  'NegativeLabCommandEnvelopeV1',
  'AgentPreviewRenderRequestV1',
  'PreviewScopeQueryV1',
  'ProjectLibraryCommandEnvelopeV1',
  'ProjectLibrarySnapshotQueryV1',
  'QueryEnvelopeV1',
  'RawEngineImageGetPreviewRequestV1',
  'ToneColorCommandEnvelopeV1',
] as const;

type RawEngineAppServerInputSchemaNameV1 = (typeof rawEngineAppServerInputSchemaNamesV1)[number];

interface RawEngineAppServerApprovalRequirementV1 {
  approvalClass: string;
  reason: string;
  recordId?: string | undefined;
  state: string;
}

interface RawEngineAppServerToolDefinitionV1 {
  approvalClass: string;
  inputSchemaName: string;
  mutates: boolean;
  requiresDryRun: boolean;
  toolKind: string;
  toolName: string;
}

interface RawEngineAppServerToolRegistryV1 {
  tools: Array<RawEngineAppServerToolDefinitionV1>;
}

export type AppServerCommandSchemaDependenciesV1 = {
  approvalRequirementSchema: z.ZodType<RawEngineAppServerApprovalRequirementV1>;
  knownInputSchemas: Record<RawEngineAppServerInputSchemaNameV1, z.ZodType>;
  rawEngineToolKindSchema: z.ZodType<string>;
  rawEngineToolRegistryV1Schema: z.ZodType<RawEngineAppServerToolRegistryV1>;
  schemaVersion: 1;
};

export function createAppServerCommandSchemasV1(dependencies: AppServerCommandSchemaDependenciesV1) {
  const rawEngineAppServerTransportV1Schema = z.enum(['stdio', 'websocket', 'unix_socket']);

  const rawEngineAppServerProtocolV1Schema = z.literal('codex_app_server_json_rpc');
  const commandDryRunFlagSchema = z.looseObject({ dryRun: z.boolean() });

  const rawEngineAppServerToolCallV1Schema = z
    .object({
      approval: dependencies.approvalRequirementSchema,
      arguments: z.unknown(),
      dryRun: z.boolean(),
      inputSchemaName: z.enum(rawEngineAppServerInputSchemaNamesV1),
      itemId: z.string().trim().min(1).optional(),
      jsonRpcRequestId: z.union([z.string().trim().min(1), z.number().int().nonnegative()]),
      protocol: rawEngineAppServerProtocolV1Schema,
      schemaVersion: z.literal(dependencies.schemaVersion),
      threadId: z.string().trim().min(1),
      toolKind: dependencies.rawEngineToolKindSchema,
      toolName: z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/u),
      transport: rawEngineAppServerTransportV1Schema,
      turnId: z.string().trim().min(1),
    })
    .strict()
    .superRefine((toolCall, context) => {
      const inputSchema = dependencies.knownInputSchemas[toolCall.inputSchemaName];
      const parsedArguments = inputSchema.safeParse(toolCall.arguments);

      if (!parsedArguments.success) {
        context.addIssue({
          code: 'custom',
          message: `Tool call arguments must match ${toolCall.inputSchemaName}.`,
          path: ['arguments'],
        });
        return;
      }

      const commandDryRunFlag = commandDryRunFlagSchema.safeParse(parsedArguments.data);
      if (commandDryRunFlag.success && commandDryRunFlag.data.dryRun !== toolCall.dryRun) {
        context.addIssue({
          code: 'custom',
          message: 'Tool call dryRun flag must match the wrapped command envelope.',
          path: ['dryRun'],
        });
      }
    });

  const rawEngineAppServerToolCallValidationV1Schema = z
    .object({
      registry: dependencies.rawEngineToolRegistryV1Schema,
      schemaVersion: z.literal(dependencies.schemaVersion),
      toolCall: rawEngineAppServerToolCallV1Schema,
    })
    .strict()
    .superRefine((validation, context) => {
      const toolDefinition = validation.registry.tools.find((tool) => tool.toolName === validation.toolCall.toolName);

      if (toolDefinition === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'App-server tool call must reference a registered RawEngine tool.',
          path: ['toolCall', 'toolName'],
        });
        return;
      }

      if (toolDefinition.toolKind !== validation.toolCall.toolKind) {
        context.addIssue({
          code: 'custom',
          message: 'App-server tool call kind must match the registered tool definition.',
          path: ['toolCall', 'toolKind'],
        });
      }

      if (toolDefinition.inputSchemaName !== validation.toolCall.inputSchemaName) {
        context.addIssue({
          code: 'custom',
          message: 'App-server tool call input schema must match the registered tool definition.',
          path: ['toolCall', 'inputSchemaName'],
        });
      }

      if (toolDefinition.requiresDryRun && !validation.toolCall.dryRun) {
        context.addIssue({
          code: 'custom',
          message: 'App-server tool call must be a dry run when the registered tool requires dry-run execution.',
          path: ['toolCall', 'dryRun'],
        });
      }

      if (toolDefinition.approvalClass !== validation.toolCall.approval.approvalClass) {
        context.addIssue({
          code: 'custom',
          message: 'App-server tool call approval class must match the registered tool definition.',
          path: ['toolCall', 'approval', 'approvalClass'],
        });
      }

      if (toolDefinition.mutates && validation.toolCall.approval.state !== 'approved') {
        context.addIssue({
          code: 'custom',
          message: 'Mutating app-server tool calls require approved user approval before execution.',
          path: ['toolCall', 'approval', 'state'],
        });
      }
    });

  return {
    rawEngineAppServerProtocolV1Schema,
    rawEngineAppServerToolCallV1Schema,
    rawEngineAppServerToolCallValidationV1Schema,
    rawEngineAppServerTransportV1Schema,
  };
}
