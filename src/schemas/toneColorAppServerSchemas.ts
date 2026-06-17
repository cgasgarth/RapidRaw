import { z } from 'zod';

export const toneColorAppServerRouteExecutionModeSchema = z.enum(['dry_run_command', 'apply_dry_run_plan']);
export const toneColorAppServerRouteStatusSchema = z.enum(['mapped']);

export const toneColorAppServerRouteSchema = z
  .object({
    commandType: z.literal('toneColor.setBasicTone'),
    executionMode: toneColorAppServerRouteExecutionModeSchema,
    inputSchemaName: z.literal('ToneColorCommandEnvelopeV1'),
    outputSchemaName: z.enum(['ToneColorDryRunResultV1', 'ToneColorMutationResultV1']),
    reason: z.string().trim().min(1),
    runtimeCheckScript: z.literal('check:basic-tone-command-bridge'),
    status: toneColorAppServerRouteStatusSchema,
    toolName: z
      .string()
      .trim()
      .regex(/^tonecolor\.(?:dry_run_command|apply_command)$/u),
  })
  .strict()
  .superRefine((route, context) => {
    if (route.executionMode === 'dry_run_command' && route.outputSchemaName !== 'ToneColorDryRunResultV1') {
      context.addIssue({
        code: 'custom',
        message: 'Dry-run tone-color routes must return dry-run results.',
        path: ['outputSchemaName'],
      });
    }

    if (route.executionMode === 'apply_dry_run_plan' && route.outputSchemaName !== 'ToneColorMutationResultV1') {
      context.addIssue({
        code: 'custom',
        message: 'Apply tone-color routes must return mutation results.',
        path: ['outputSchemaName'],
      });
    }
  });

export const toneColorAppServerRouteManifestSchema = z
  .object({
    routes: z.array(toneColorAppServerRouteSchema).length(2),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const toolNames = new Set<string>();
    for (const [index, route] of manifest.routes.entries()) {
      if (toolNames.has(route.toolName)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate tone-color route tool name.',
          path: ['routes', index],
        });
      }
      toolNames.add(route.toolName);
    }
  });

export type ToneColorAppServerRoute = z.infer<typeof toneColorAppServerRouteSchema>;
export type ToneColorAppServerRouteManifest = z.infer<typeof toneColorAppServerRouteManifestSchema>;
