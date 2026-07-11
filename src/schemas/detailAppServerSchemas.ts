import { z } from 'zod';

import {
  DETAIL_APP_SERVER_COMMAND_TYPES,
  DETAIL_APP_SERVER_EXECUTION_MODES,
  DETAIL_APP_SERVER_FEATURES,
  DETAIL_APP_SERVER_ROUTE_STATUSES,
  DetailAppServerCommandType,
  DetailAppServerExecutionMode,
  DetailAppServerSchemaName,
  DetailAppServerToolName,
} from '../utils/detail/detailAppServerRouteIds';

const detailAppServerRouteFeatureSchema = z.enum(DETAIL_APP_SERVER_FEATURES);
const detailAppServerRouteExecutionModeSchema = z.enum(DETAIL_APP_SERVER_EXECUTION_MODES);
const detailAppServerRouteStatusSchema = z.enum(DETAIL_APP_SERVER_ROUTE_STATUSES);

const detailAppServerRouteSchema = z
  .object({
    commandType: z.enum(DETAIL_APP_SERVER_COMMAND_TYPES),
    executionMode: detailAppServerRouteExecutionModeSchema,
    feature: detailAppServerRouteFeatureSchema,
    inputSchemaName: z.literal(DetailAppServerSchemaName.CommandEnvelope),
    outputSchemaName: z.literal(DetailAppServerSchemaName.DryRunResult),
    reason: z.string().trim().min(1),
    runtimeCheckScript: z.string().trim().min(1),
    status: detailAppServerRouteStatusSchema,
    toolName: z.enum([DetailAppServerToolName.DryRunCommand, DetailAppServerToolName.ApplyCommand]),
  })
  .strict()
  .superRefine((route, context) => {
    if (
      route.executionMode === DetailAppServerExecutionMode.DryRunCommand &&
      route.commandType !== DetailAppServerCommandType.DryRunControls
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Deblur dry-run routes must use the dry-run command type.',
        path: ['commandType'],
      });
    }

    if (
      route.executionMode === DetailAppServerExecutionMode.ApplyDryRunPlan &&
      route.commandType !== DetailAppServerCommandType.ApplyControls
    ) {
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
