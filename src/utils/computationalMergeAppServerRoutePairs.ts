import type { ComputationalMergeAppServerRouteFamily } from '../schemas/computationalMergeAppServerSchemas';

interface ComputationalMergeAppServerRoutePairSummary {
  applyToolName: string;
  dryRunToolName: string;
}

export const COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_PAIRS: Record<
  ComputationalMergeAppServerRouteFamily,
  ComputationalMergeAppServerRoutePairSummary
> = {
  focus_stack: {
    applyToolName: 'computationalmerge.focus_stack.apply_command',
    dryRunToolName: 'computationalmerge.focus_stack.dry_run_command',
  },
  hdr: {
    applyToolName: 'computationalmerge.hdr.apply_command',
    dryRunToolName: 'computationalmerge.hdr.dry_run_command',
  },
  panorama: {
    applyToolName: 'computationalmerge.panorama.apply_command',
    dryRunToolName: 'computationalmerge.panorama.dry_run_command',
  },
  super_resolution: {
    applyToolName: 'computationalmerge.super_resolution.apply_command',
    dryRunToolName: 'computationalmerge.super_resolution.dry_run_command',
  },
};

export function getComputationalMergeAppServerRoutePairSummary(
  family: ComputationalMergeAppServerRouteFamily,
): ComputationalMergeAppServerRoutePairSummary {
  return COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_PAIRS[family];
}
