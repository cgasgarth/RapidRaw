import type {
  ComputationalMergeAppServerRoute,
  ComputationalMergeAppServerRouteFamily,
  ComputationalMergeAppServerRouteManifest,
} from '../../schemas/computationalMergeAppServerSchemas';
import { getComputationalMergeAppServerToolName } from './computationalMergeAppServerToolNames';

const dryRunOutputSchemaName = 'ComputationalMergeDryRunResultV1';
const applyOutputSchemaName = 'ComputationalMergeMutationResultV1';
const inputSchemaName = 'ComputationalMergeCommandEnvelopeV1';
const openDerivedSourceInputSchemaName = 'ComputationalMergeDerivedSourceOpenRequestV1';
const openDerivedSourceOutputSchemaName = 'ComputationalMergeDerivedSourceOpenResultV1';

export const COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST_DATA = {
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
      toolName: getComputationalMergeAppServerToolName('hdr', 'dry_run_command'),
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
      toolName: getComputationalMergeAppServerToolName('hdr', 'apply_command'),
    },
    {
      commandType: 'computationalMerge.createHdr',
      executionMode: 'open_derived_source',
      family: 'hdr',
      inputSchemaName: openDerivedSourceInputSchemaName,
      outputSchemaName: openDerivedSourceOutputSchemaName,
      reason: 'HDR derived-source open requires an approved apply result plus a current matching receipt.',
      runtimeCheckScript: 'check:hdr-app-server-runtime',
      status: 'mapped',
      toolName: getComputationalMergeAppServerToolName('hdr', 'open_derived_source'),
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
      toolName: getComputationalMergeAppServerToolName('panorama', 'dry_run_command'),
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
      toolName: getComputationalMergeAppServerToolName('panorama', 'apply_command'),
    },
    {
      commandType: 'computationalMerge.createPanorama',
      executionMode: 'open_derived_source',
      family: 'panorama',
      inputSchemaName: openDerivedSourceInputSchemaName,
      outputSchemaName: openDerivedSourceOutputSchemaName,
      reason: 'Panorama derived-source open requires an approved apply result plus a current matching receipt.',
      runtimeCheckScript: 'check:panorama-app-server-runtime',
      status: 'mapped',
      toolName: getComputationalMergeAppServerToolName('panorama', 'open_derived_source'),
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
      toolName: getComputationalMergeAppServerToolName('focus_stack', 'dry_run_command'),
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
      toolName: getComputationalMergeAppServerToolName('focus_stack', 'apply_command'),
    },
    {
      commandType: 'computationalMerge.createFocusStack',
      executionMode: 'open_derived_source',
      family: 'focus_stack',
      inputSchemaName: openDerivedSourceInputSchemaName,
      outputSchemaName: openDerivedSourceOutputSchemaName,
      reason: 'Focus stack derived-source open requires an approved apply result plus a current matching receipt.',
      runtimeCheckScript: 'check:focus-app-server-runtime',
      status: 'mapped',
      toolName: getComputationalMergeAppServerToolName('focus_stack', 'open_derived_source'),
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
      toolName: getComputationalMergeAppServerToolName('super_resolution', 'dry_run_command'),
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
      toolName: getComputationalMergeAppServerToolName('super_resolution', 'apply_command'),
    },
    {
      commandType: 'computationalMerge.createSuperResolution',
      executionMode: 'open_derived_source',
      family: 'super_resolution',
      inputSchemaName: openDerivedSourceInputSchemaName,
      outputSchemaName: openDerivedSourceOutputSchemaName,
      reason: 'Super-resolution derived-source open requires an approved apply result plus a current matching receipt.',
      runtimeCheckScript: 'check:sr-app-server-runtime',
      status: 'mapped',
      toolName: getComputationalMergeAppServerToolName('super_resolution', 'open_derived_source'),
    },
  ],
  schemaVersion: 1,
} satisfies ComputationalMergeAppServerRouteManifest;

export const COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_DATA = COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST_DATA.routes;

export interface ComputationalMergeAppServerRoutePairData {
  apply: ComputationalMergeAppServerRoute;
  dryRun: ComputationalMergeAppServerRoute;
}

export function getComputationalMergeAppServerRoutePairData(
  family: ComputationalMergeAppServerRouteFamily,
): ComputationalMergeAppServerRoutePairData {
  const dryRun = COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_DATA.find(
    (route) => route.family === family && route.executionMode === 'dry_run_command',
  );
  const apply = COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_DATA.find(
    (route) => route.family === family && route.executionMode === 'apply_dry_run_plan',
  );

  if (dryRun === undefined || apply === undefined) {
    throw new Error(`Computational merge app-server route pair is incomplete for ${family}.`);
  }

  return { apply, dryRun };
}
