import negativeLabStockRegistryJson from '../data/negativeLabStockRegistry.json';
import {
  type NegativeLabStockRegistry,
  negativeLabStockRegistrySchema,
} from '../schemas/negativeLabStockRegistrySchemas';

export const NEGATIVE_LAB_STOCK_REGISTRY: NegativeLabStockRegistry =
  negativeLabStockRegistrySchema.parse(negativeLabStockRegistryJson);

export const buildNegativeLabStockRegistryCounts = (registry: NegativeLabStockRegistry) => {
  const runtimeSafeCount = registry.entries.filter(
    (entry) => entry.claimTier === 'generic_family_starting_point',
  ).length;
  const referenceOnlyCount = registry.entries.filter((entry) => entry.claimTier === 'reference_mapping_only').length;

  return {
    referenceOnlyCount,
    runtimeSafeCount,
    totalCount: registry.entries.length,
  };
};
