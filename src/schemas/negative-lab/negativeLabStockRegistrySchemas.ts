import { z } from 'zod';

import { negativeLabPresetIdSchema } from './negativeLabPresetCatalogSchemas';

export const NEGATIVE_LAB_STOCK_REGISTRY_SCHEMA_VERSION = 1;

export const negativeLabStockRegistryProcessFamilySchema = z.enum([
  'black_and_white_silver_negative',
  'c41_color_negative',
  'ecn2_cinema_negative',
  'e6_color_reversal',
]);
export const negativeLabStockRegistryCategorySchema = z.enum([
  'black_and_white',
  'cinema_negative',
  'color_negative',
  'color_reversal',
]);
export const negativeLabStockRegistryAvailabilitySchema = z.enum([
  'archival_common',
  'current_common',
  'specialty_or_region_limited',
]);
export const negativeLabStockRegistryClaimTierSchema = z.enum([
  'generic_family_starting_point',
  'reference_mapping_only',
  'measured_profile_required',
]);
export const negativeLabStockRegistryLegalNamingStatusSchema = z.enum([
  'descriptive_generic_only',
  'named_stock_reference_only',
  'legal_review_required',
]);
export const negativeLabStockRegistryFixtureStatusSchema = z.enum([
  'metadata_only',
  'fixture_needed',
  'measured_fixture_available',
]);
export const negativeLabStockRegistryIdSchema = z.string().regex(/^negative_lab\.stock_family\.[a-z0-9_]+\.v[0-9]+$/u);

export const negativeLabStockRegistryEntrySchema = z
  .object({
    availability: negativeLabStockRegistryAvailabilitySchema,
    category: negativeLabStockRegistryCategorySchema,
    claimTier: negativeLabStockRegistryClaimTierSchema,
    colorResponseNotes: z.string().trim().min(1).max(220),
    contrastCurveDescriptor: z.string().trim().min(1).max(120),
    fixtureStatus: negativeLabStockRegistryFixtureStatusSchema,
    genericPresetId: negativeLabPresetIdSchema.nullable(),
    grainModelDescriptor: z.string().trim().min(1).max(120),
    isoClass: z.string().trim().min(1).max(80),
    legalNamingStatus: negativeLabStockRegistryLegalNamingStatusSchema,
    processFamily: negativeLabStockRegistryProcessFamilySchema,
    registryId: negativeLabStockRegistryIdSchema,
    sourceReferences: z.array(z.string().trim().min(1)).min(1),
    stockFamilyDescriptor: z.string().trim().min(1).max(120),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.claimTier === 'generic_family_starting_point' && entry.genericPresetId === null) {
      context.addIssue({
        code: 'custom',
        message: 'Generic stock-family starting points require a generic preset mapping.',
        path: ['genericPresetId'],
      });
    }

    if (entry.claimTier !== 'generic_family_starting_point' && entry.genericPresetId !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Reference-only or measured-required stock entries must not map to runtime presets yet.',
        path: ['genericPresetId'],
      });
    }

    if (entry.legalNamingStatus !== 'descriptive_generic_only' && entry.claimTier === 'generic_family_starting_point') {
      context.addIssue({
        code: 'custom',
        message: 'Runtime generic stock-family mappings must use descriptive generic naming.',
        path: ['legalNamingStatus'],
      });
    }

    if (entry.fixtureStatus === 'measured_fixture_available' && entry.claimTier !== 'measured_profile_required') {
      context.addIssue({
        code: 'custom',
        message: 'Measured stock fixtures must be represented by measured-profile work, not generic mappings.',
        path: ['claimTier'],
      });
    }
  });

export const negativeLabStockRegistrySchema = z
  .object({
    entries: z.array(negativeLabStockRegistryEntrySchema).min(1),
    registryId: z.literal('negative_lab_stock_registry'),
    registryVersion: z.string().trim().min(1),
    schemaVersion: z.literal(NEGATIVE_LAB_STOCK_REGISTRY_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((registry, context) => {
    const ids = new Set<string>();
    const requiredCategories = ['black_and_white', 'cinema_negative', 'color_negative', 'color_reversal'] as const;

    for (const [index, entry] of registry.entries.entries()) {
      if (ids.has(entry.registryId)) {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab stock registry entries must be unique.',
          path: ['entries', index, 'registryId'],
        });
      }
      ids.add(entry.registryId);
    }

    for (const category of requiredCategories) {
      if (!registry.entries.some((entry) => entry.category === category)) {
        context.addIssue({
          code: 'custom',
          message: `Negative Lab stock registry requires ${category} coverage.`,
          path: ['entries'],
        });
      }
    }
  });

export type NegativeLabStockRegistry = z.infer<typeof negativeLabStockRegistrySchema>;
export type NegativeLabStockRegistryEntry = z.infer<typeof negativeLabStockRegistryEntrySchema>;
export type NegativeLabStockRegistryId = z.infer<typeof negativeLabStockRegistryIdSchema>;

export const parseNegativeLabStockRegistry = (value: unknown): NegativeLabStockRegistry =>
  negativeLabStockRegistrySchema.parse(value);
