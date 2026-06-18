import { z } from 'zod';

export const detailAppServerRouteFeatureSchema = z.enum(['deblur']);
export const detailAppServerRouteExecutionModeSchema = z.enum(['apply_dry_run_plan', 'dry_run_command']);
export const detailAppServerRouteStatusSchema = z.enum(['mapped_unavailable']);

export const detailAppServerRouteSchema = z
  .object({
    commandType: z.enum(['detailDeblur.applyControls', 'detailDeblur.dryRunControls']),
    executionMode: detailAppServerRouteExecutionModeSchema,
    feature: detailAppServerRouteFeatureSchema,
    inputSchemaName: z.literal('DetailDeblurCommandEnvelopeV1'),
    outputSchemaName: z.literal('DetailDeblurDryRunResultV1'),
    reason: z.string().trim().min(1),
    runtimeCheckScript: z.string().trim().min(1),
    status: detailAppServerRouteStatusSchema,
    toolName: z
      .string()
      .trim()
      .regex(/^detail\.deblur\.(?:dry_run_command|apply_command)$/u),
  })
  .strict()
  .superRefine((route, context) => {
    if (route.executionMode === 'dry_run_command' && route.commandType !== 'detailDeblur.dryRunControls') {
      context.addIssue({
        code: 'custom',
        message: 'Deblur dry-run routes must use the dry-run command type.',
        path: ['commandType'],
      });
    }

    if (route.executionMode === 'apply_dry_run_plan' && route.commandType !== 'detailDeblur.applyControls') {
      context.addIssue({
        code: 'custom',
        message: 'Deblur apply routes must use the apply command type.',
        path: ['commandType'],
      });
    }
  });

export const detailAppServerRouteManifestSchema = z
  .object({
    routes: z.array(detailAppServerRouteSchema).min(1),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const toolNames = new Set<string>();
    for (const [index, route] of manifest.routes.entries()) {
      if (toolNames.has(route.toolName)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate detail app-server route tool name.',
          path: ['routes', index],
        });
      }
      toolNames.add(route.toolName);
    }
  });

export type DetailAppServerRoute = z.infer<typeof detailAppServerRouteSchema>;
export type DetailAppServerRouteManifest = z.infer<typeof detailAppServerRouteManifestSchema>;
