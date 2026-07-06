import { z } from 'zod';

const computationalMergeAppServerRouteFamilySchema = z.enum(['hdr', 'panorama', 'focus_stack', 'super_resolution']);
const computationalMergeAppServerRouteExecutionModeSchema = z.enum([
  'apply_dry_run_plan',
  'dry_run_command',
  'open_derived_source',
]);
const computationalMergeAppServerRouteStatusSchema = z.enum(['mapped']);

const computationalMergeAppServerRouteSchema = z
  .object({
    commandType: z.enum([
      'computationalMerge.createFocusStack',
      'computationalMerge.createHdr',
      'computationalMerge.createPanorama',
      'computationalMerge.createSuperResolution',
    ]),
    executionMode: computationalMergeAppServerRouteExecutionModeSchema,
    family: computationalMergeAppServerRouteFamilySchema,
    inputSchemaName: z.enum(['ComputationalMergeCommandEnvelopeV1', 'ComputationalMergeDerivedSourceOpenRequestV1']),
    outputSchemaName: z.enum([
      'ComputationalMergeDerivedSourceOpenResultV1',
      'ComputationalMergeDryRunResultV1',
      'ComputationalMergeMutationResultV1',
    ]),
    reason: z.string().trim().min(1),
    runtimeCheckScript: z.string().trim().min(1),
    status: computationalMergeAppServerRouteStatusSchema,
    toolName: z
      .string()
      .trim()
      .regex(
        /^computationalmerge\.(?:focus_stack|hdr|panorama|super_resolution)\.(?:dry_run_command|apply_command|open_derived_source)$/u,
      ),
  })
  .strict()
  .superRefine((route, context) => {
    if (route.executionMode === 'dry_run_command' && route.outputSchemaName !== 'ComputationalMergeDryRunResultV1') {
      context.addIssue({
        code: 'custom',
        message: 'Dry-run computational merge routes must return dry-run results.',
        path: ['outputSchemaName'],
      });
    }

    if (
      route.executionMode !== 'open_derived_source' &&
      route.inputSchemaName !== 'ComputationalMergeCommandEnvelopeV1'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Dry-run and apply computational merge routes must accept command envelopes.',
        path: ['inputSchemaName'],
      });
    }

    if (
      route.executionMode === 'apply_dry_run_plan' &&
      route.outputSchemaName !== 'ComputationalMergeMutationResultV1'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Apply computational merge routes must return mutation results.',
        path: ['outputSchemaName'],
      });
    }

    if (route.executionMode === 'open_derived_source') {
      if (route.inputSchemaName !== 'ComputationalMergeDerivedSourceOpenRequestV1') {
        context.addIssue({
          code: 'custom',
          message: 'Open-derived-source computational merge routes must accept derived-source open requests.',
          path: ['inputSchemaName'],
        });
      }
      if (route.outputSchemaName !== 'ComputationalMergeDerivedSourceOpenResultV1') {
        context.addIssue({
          code: 'custom',
          message: 'Open-derived-source computational merge routes must return derived-source open results.',
          path: ['outputSchemaName'],
        });
      }
    }
  });

export const computationalMergeAppServerRouteManifestSchema = z
  .object({
    routes: z.array(computationalMergeAppServerRouteSchema).min(1),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const toolNames = new Set<string>();
    for (const [index, route] of manifest.routes.entries()) {
      if (toolNames.has(route.toolName)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate computational route tool name.',
          path: ['routes', index],
        });
      }
      toolNames.add(route.toolName);
    }
  });

export type ComputationalMergeAppServerRoute = z.infer<typeof computationalMergeAppServerRouteSchema>;
export type ComputationalMergeAppServerRouteFamily = z.infer<typeof computationalMergeAppServerRouteFamilySchema>;
export type ComputationalMergeAppServerRouteManifest = z.infer<typeof computationalMergeAppServerRouteManifestSchema>;
