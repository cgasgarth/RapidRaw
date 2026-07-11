import { z } from 'zod';

import {
  TONE_COLOR_APP_SERVER_COMMAND_TYPES,
  TONE_COLOR_APP_SERVER_EXECUTION_MODES,
  TONE_COLOR_APP_SERVER_OUTPUT_SCHEMA_NAMES,
  TONE_COLOR_APP_SERVER_ROUTE_STATUSES,
  TONE_COLOR_APP_SERVER_TOOL_NAMES,
  ToneColorAppServerExecutionMode,
  ToneColorAppServerSchemaName,
} from '../../utils/toneColorAppServerRouteIds';

const toneColorAppServerRouteExecutionModeSchema = z.enum(TONE_COLOR_APP_SERVER_EXECUTION_MODES);
const toneColorAppServerRouteStatusSchema = z.enum(TONE_COLOR_APP_SERVER_ROUTE_STATUSES);

const toneColorAppServerRouteSchema = z
  .object({
    commandType: z.enum(TONE_COLOR_APP_SERVER_COMMAND_TYPES),
    executionMode: toneColorAppServerRouteExecutionModeSchema,
    inputSchemaName: z.literal(ToneColorAppServerSchemaName.CommandEnvelope),
    outputSchemaName: z.enum(TONE_COLOR_APP_SERVER_OUTPUT_SCHEMA_NAMES),
    reason: z.string().trim().min(1),
    runtimeCheckScript: z.enum([
      'check:basic-tone-command-bridge',
      'check:profile-tone',
      'check:white-balance-picker',
      'check:selective-color-ranges',
      'check:color-grading-presets',
      'check:levels-runtime',
      'check:channel-mixer',
      'check:color-balance-rgb',
      'check:black-white-mixer',
      'check:skin-tone-uniformity',
    ]),
    status: toneColorAppServerRouteStatusSchema,
    toolName: z.enum(TONE_COLOR_APP_SERVER_TOOL_NAMES),
  })
  .strict()
  .superRefine((route, context) => {
    if (
      route.executionMode === ToneColorAppServerExecutionMode.DryRunCommand &&
      route.outputSchemaName !== ToneColorAppServerSchemaName.DryRunResult
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Dry-run tone-color routes must return dry-run results.',
        path: ['outputSchemaName'],
      });
    }

    if (
      route.executionMode === ToneColorAppServerExecutionMode.ApplyDryRunPlan &&
      route.outputSchemaName !== ToneColorAppServerSchemaName.MutationResult
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Apply tone-color routes must return mutation results.',
        path: ['outputSchemaName'],
      });
    }
  });

export const toneColorAppServerRouteManifestSchema = z
  .object({
    routes: z.array(toneColorAppServerRouteSchema).min(2),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const routeKeys = new Set<string>();
    for (const [index, route] of manifest.routes.entries()) {
      const routeKey = `${route.commandType}:${route.executionMode}`;
      if (routeKeys.has(routeKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate tone-color command execution route.',
          path: ['routes', index],
        });
      }
      routeKeys.add(routeKey);
    }
  });
