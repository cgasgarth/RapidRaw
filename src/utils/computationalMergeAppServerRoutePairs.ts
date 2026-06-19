import { getComputationalMergeAppServerToolName } from './computationalMergeAppServerToolNames';

import type { ComputationalMergeAppServerRouteFamily } from '../schemas/computationalMergeAppServerSchemas';

interface ComputationalMergeAppServerRoutePairSummary {
  applyToolName: string;
  dryRunToolName: string;
}

const buildComputationalMergeAppServerRoutePairSummary = (
  family: ComputationalMergeAppServerRouteFamily,
): ComputationalMergeAppServerRoutePairSummary => {
  return {
    applyToolName: getComputationalMergeAppServerToolName(family, 'apply_command'),
    dryRunToolName: getComputationalMergeAppServerToolName(family, 'dry_run_command'),
  };
};

export const COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_PAIRS = {
  focus_stack: buildComputationalMergeAppServerRoutePairSummary('focus_stack'),
  hdr: buildComputationalMergeAppServerRoutePairSummary('hdr'),
  panorama: buildComputationalMergeAppServerRoutePairSummary('panorama'),
  super_resolution: buildComputationalMergeAppServerRoutePairSummary('super_resolution'),
} satisfies Record<ComputationalMergeAppServerRouteFamily, ComputationalMergeAppServerRoutePairSummary>;

export function getComputationalMergeAppServerRoutePairSummary(
  family: ComputationalMergeAppServerRouteFamily,
): ComputationalMergeAppServerRoutePairSummary {
  return COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_PAIRS[family];
}
