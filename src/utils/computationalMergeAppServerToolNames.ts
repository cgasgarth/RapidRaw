import type { ComputationalMergeAppServerRouteFamily } from '../schemas/computationalMergeAppServerSchemas';

export const getComputationalMergeAppServerToolName = (
  family: ComputationalMergeAppServerRouteFamily,
  command: 'apply_command' | 'dry_run_command',
): string => `computationalmerge.${family}.${command}`;
