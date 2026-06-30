import type { ComputationalMergeAppServerRouteFamily } from '../../schemas/computationalMergeAppServerSchemas';
import { getComputationalMergeAppServerToolName } from './computationalMergeAppServerToolNames';

interface ComputationalMergeAppServerRoutePairSummary {
  applyToolName: string;
  dryRunToolName: string;
  openDerivedSourceToolName: string;
}

const buildComputationalMergeAppServerRoutePairSummary = (
  family: ComputationalMergeAppServerRouteFamily,
): ComputationalMergeAppServerRoutePairSummary => {
  return {
    applyToolName: getComputationalMergeAppServerToolName(family, 'apply_command'),
    dryRunToolName: getComputationalMergeAppServerToolName(family, 'dry_run_command'),
    openDerivedSourceToolName: getComputationalMergeAppServerToolName(family, 'open_derived_source'),
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
