import { computationalMergeAppServerRouteManifestSchema } from '../schemas/computationalMergeAppServerSchemas';

import type {
  ComputationalMergeAppServerRoute,
  ComputationalMergeAppServerRouteFamily,
} from '../schemas/computationalMergeAppServerSchemas';

const dryRunOutputSchemaName = 'ComputationalMergeDryRunResultV1';
const applyOutputSchemaName = 'ComputationalMergeMutationResultV1';
const inputSchemaName = 'ComputationalMergeCommandEnvelopeV1';

export const COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST = computationalMergeAppServerRouteManifestSchema.parse({
  routes: [
    {
      commandType: 'computationalMerge.createHdr',
      executionMode: 'dry_run_command',
      family: 'hdr',
      inputSchemaName,
      outputSchemaName: dryRunOutputSchemaName,
      reason: 'HDR merge dry-runs use the executable HDR app-server runtime bus before any graph mutation.',
      runtimeCheckScript: 'check:hdr-app-server-runtime',
      status: 'mapped',
      toolName: 'computationalmerge.hdr.dry_run_command',
    },
    {
      commandType: 'computationalMerge.createHdr',
      executionMode: 'apply_dry_run_plan',
      family: 'hdr',
      inputSchemaName,
      outputSchemaName: applyOutputSchemaName,
      reason: 'HDR merge applies require an accepted HDR dry-run plan and edit-apply approval.',
      runtimeCheckScript: 'check:hdr-app-server-runtime',
      status: 'mapped',
      toolName: 'computationalmerge.hdr.apply_command',
    },
    {
      commandType: 'computationalMerge.createPanorama',
      executionMode: 'dry_run_command',
      family: 'panorama',
      inputSchemaName,
      outputSchemaName: dryRunOutputSchemaName,
      reason: 'Panorama dry-runs use the executable panorama app-server runtime bus before any graph mutation.',
      runtimeCheckScript: 'check:panorama-app-server-runtime',
      status: 'mapped',
      toolName: 'computationalmerge.panorama.dry_run_command',
    },
    {
      commandType: 'computationalMerge.createPanorama',
      executionMode: 'apply_dry_run_plan',
      family: 'panorama',
      inputSchemaName,
      outputSchemaName: applyOutputSchemaName,
      reason: 'Panorama applies require an accepted stitch dry-run plan and edit-apply approval.',
      runtimeCheckScript: 'check:panorama-app-server-runtime',
      status: 'mapped',
      toolName: 'computationalmerge.panorama.apply_command',
    },
    {
      commandType: 'computationalMerge.createFocusStack',
      executionMode: 'dry_run_command',
      family: 'focus_stack',
      inputSchemaName,
      outputSchemaName: dryRunOutputSchemaName,
      reason: 'Focus stack dry-runs use the executable focus app-server runtime bus before any graph mutation.',
      runtimeCheckScript: 'check:focus-app-server-runtime',
      status: 'mapped',
      toolName: 'computationalmerge.focus_stack.dry_run_command',
    },
    {
      commandType: 'computationalMerge.createFocusStack',
      executionMode: 'apply_dry_run_plan',
      family: 'focus_stack',
      inputSchemaName,
      outputSchemaName: applyOutputSchemaName,
      reason: 'Focus stack applies require an accepted stack dry-run plan and edit-apply approval.',
      runtimeCheckScript: 'check:focus-app-server-runtime',
      status: 'mapped',
      toolName: 'computationalmerge.focus_stack.apply_command',
    },
    {
      commandType: 'computationalMerge.createSuperResolution',
      executionMode: 'dry_run_command',
      family: 'super_resolution',
      inputSchemaName,
      outputSchemaName: dryRunOutputSchemaName,
      reason: 'Super-resolution dry-runs use the executable SR app-server runtime bus before any graph mutation.',
      runtimeCheckScript: 'check:sr-app-server-runtime',
      status: 'mapped',
      toolName: 'computationalmerge.super_resolution.dry_run_command',
    },
    {
      commandType: 'computationalMerge.createSuperResolution',
      executionMode: 'apply_dry_run_plan',
      family: 'super_resolution',
      inputSchemaName,
      outputSchemaName: applyOutputSchemaName,
      reason: 'Super-resolution applies require an accepted SR dry-run plan and edit-apply approval.',
      runtimeCheckScript: 'check:sr-app-server-runtime',
      status: 'mapped',
      toolName: 'computationalmerge.super_resolution.apply_command',
    },
  ],
  schemaVersion: 1,
});

export const COMPUTATIONAL_MERGE_APP_SERVER_ROUTES = COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST.routes;

export interface ComputationalMergeAppServerRoutePair {
  apply: ComputationalMergeAppServerRoute;
  dryRun: ComputationalMergeAppServerRoute;
}

export function getComputationalMergeAppServerRoutePair(
  family: ComputationalMergeAppServerRouteFamily,
): ComputationalMergeAppServerRoutePair {
  const dryRun = COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.find(
    (route) => route.family === family && route.executionMode === 'dry_run_command',
  );
  const apply = COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.find(
    (route) => route.family === family && route.executionMode === 'apply_dry_run_plan',
  );

  if (dryRun === undefined || apply === undefined) {
    throw new Error(`Computational merge app-server route pair is incomplete for ${family}.`);
  }

  return { apply, dryRun };
}
