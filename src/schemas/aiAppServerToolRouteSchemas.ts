import { z } from 'zod';

export const aiAppServerToolRouteStatusSchema = z.enum(['mapped', 'deferred', 'connector_status', 'metadata_cleanup']);
export const aiAppServerToolRouteSourceKindSchema = z.enum(['tauri_invoke', 'app_server_tool']);
export const aiAppServerToolRouteExecutionModeSchema = z.enum(['dry_run_command', 'apply_dry_run_plan']);
export const aiAppServerToolCapabilitySchema = z.enum([
  'depth_mask',
  'denoise',
  'enhance',
  'foreground_mask',
  'inpaint',
  'sky_mask',
  'subject_mask',
]);

export const aiAppServerToolRouteSchema = z
  .object({
    appServerToolName: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/u)
      .optional(),
    commandSchemaName: z.string().trim().min(1).optional(),
    executionMode: aiAppServerToolRouteExecutionModeSchema.optional(),
    outputSchemaName: z.string().trim().min(1).optional(),
    toolCapability: aiAppServerToolCapabilitySchema.optional(),
    deferredIssue: z
      .string()
      .trim()
      .regex(/^#[1-9][0-9]*$/u)
      .optional(),
    reason: z.string().trim().min(1),
    sourceKind: aiAppServerToolRouteSourceKindSchema,
    sourceOperation: z.string().trim().min(1),
    status: aiAppServerToolRouteStatusSchema,
  })
  .strict()
  .superRefine((route, context) => {
    if (route.status === 'mapped') {
      if (route.appServerToolName === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Mapped AI routes require an app-server tool name.',
          path: ['appServerToolName'],
        });
      }

      if (route.commandSchemaName === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Mapped AI routes require a command schema name.',
          path: ['commandSchemaName'],
        });
      }

      if (route.toolCapability === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Mapped AI routes require a tool capability.',
          path: ['toolCapability'],
        });
      }

      if (route.outputSchemaName === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Mapped AI routes require an output schema name.',
          path: ['outputSchemaName'],
        });
      }

      if (route.executionMode === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Mapped AI routes require an execution mode.',
          path: ['executionMode'],
        });
      }
    }

    if (route.status === 'deferred' && route.deferredIssue === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Deferred AI routes require a tracking issue.',
        path: ['deferredIssue'],
      });
    }

    if (route.sourceKind === 'app_server_tool' && route.sourceOperation !== route.appServerToolName) {
      context.addIssue({
        code: 'custom',
        message: 'App-server tool routes must use the tool name as source operation.',
        path: ['sourceOperation'],
      });
    }
  });

export const aiAppServerToolRouteManifestSchema = z
  .object({
    routes: z.array(aiAppServerToolRouteSchema).min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

export type AiAppServerToolRoute = z.infer<typeof aiAppServerToolRouteSchema>;
export type AiAppServerToolRouteExecutionMode = z.infer<typeof aiAppServerToolRouteExecutionModeSchema>;
export type AiAppServerToolRouteManifest = z.infer<typeof aiAppServerToolRouteManifestSchema>;
export type AiAppServerToolRouteSourceKind = z.infer<typeof aiAppServerToolRouteSourceKindSchema>;
