import type { ComputationalMergePreflightWarningCodeV1 } from '../rawEngineSchemas.js';

export const computationalMergePreflightWarningCodes = {
  geometryEstimateLowConfidence: 'geometry_estimate_low_confidence',
  highMemoryEstimate: 'high_memory_estimate',
  memoryBudgetExceeded: 'memory_budget_exceeded',
  tileRuntimeDeferred: 'tile_runtime_deferred',
} satisfies Record<string, ComputationalMergePreflightWarningCodeV1>;

export const uniqueComputationalMergePreflightWarningCodes = (
  warningCodes: ComputationalMergePreflightWarningCodeV1[],
): ComputationalMergePreflightWarningCodeV1[] => Array.from(new Set(warningCodes));
