import type { ComputationalMergeAppServerRouteFamily } from '../../schemas/computational-merge/computationalMergeAppServerSchemas';

export const getComputationalMergeAppServerToolName = (
  family: ComputationalMergeAppServerRouteFamily,
  command: 'apply_command' | 'dry_run_command' | 'open_derived_source',
): string => `computationalmerge.${family}.${command}`;
