import { z } from 'zod';

import { negativeLabPresetIdSchema } from './negativeLabPresetCatalogSchemas';

export const NEGATIVE_LAB_STOCK_METADATA_CATALOG_SCHEMA_VERSION = 1;

export const negativeLabStockMetadataClassSchema = z.enum([
  'black_and_white_negative',
  'cinema_negative',
  'color_negative',
  'slide_reversal',
]);

export const negativeLabStockMetadataProcessFamilySchema = z.enum([
  'black_and_white_silver_negative',
  'c41_color_negative',
  'e6_slide_reversal',
  'ecn2_cinema_negative',
]);

export const negativeLabStockMetadataNamingTierSchema = z.enum(['named_stock_reference']);
export const negativeLabStockMetadataRuntimeStatusSchema = z.enum(['metadata_only_not_applicable']);
export const negativeLabStockMetadataClaimPolicySchema = z.enum(['reference_metadata_no_emulation_no_match_claim']);
export const negativeLabStockMetadataSourceStatusSchema = z.enum([
  'nominal_public_metadata',
  'project_verified',
  'unknown',
]);

export const negativeLabStockMetadataDoesNotProveSchema = z.enum([
  'colorimetric_match',
  'licensed_profile',
  'manufacturer_endorsement',
  'measured_profile',
  'runtime_application',
  'stock_emulation',
]);

export const negativeLabStockMetadataEntryIdSchema = z
  .string()
  .regex(/^negative_lab\.stock_metadata\.[a-z0-9_]+\.v[0-9]+$/u);

export const negativeLabStockMetadataEntrySchema = z
  .object({
    claimPolicy: negativeLabStockMetadataClaimPolicySchema,
    colorResponseNotes: z.string().trim().min(1).max(240),
    contrastCurveDescriptor: z.string().trim().min(1).max(140),
    displayName: z.string().trim().min(1).max(90),
    doesNotProve: z.array(negativeLabStockMetadataDoesNotProveSchema).min(6),
    entryId: negativeLabStockMetadataEntryIdSchema,
    grainModelDescriptor: z.string().trim().min(1).max(140),
    measurementSource: z.literal('public_or_project_metadata_only'),
    namingTier: negativeLabStockMetadataNamingTierSchema,
    nominalIso: z
      .object({
        sourceStatus: negativeLabStockMetadataSourceStatusSchema,
        unit: z.enum(['EI', 'ISO']),
        value: z.number().int().positive().max(12800),
      })
      .strict()
      .nullable(),
    processFamily: negativeLabStockMetadataProcessFamilySchema,
    runtimeStatus: negativeLabStockMetadataRuntimeStatusSchema,
    sourceReferences: z.array(z.string().trim().min(1)).min(1),
    stockClass: negativeLabStockMetadataClassSchema,
    stockFamilyDescriptor: z.string().trim().min(1).max(140),
    suggestedGenericPresetId: negativeLabPresetIdSchema.nullable(),
  })
  .strict()
  .superRefine((entry, context) => {
    const requiredNonClaims = [
      'colorimetric_match',
      'manufacturer_endorsement',
      'measured_profile',
      'runtime_application',
      'stock_emulation',
    ] as const;

    for (const requiredNonClaim of requiredNonClaims) {
      if (!entry.doesNotProve.includes(requiredNonClaim)) {
        context.addIssue({
          code: 'custom',
          message: `Named stock metadata must disclaim ${requiredNonClaim}.`,
          path: ['doesNotProve'],
        });
      }
    }

    if (entry.stockClass === 'color_negative' && entry.processFamily !== 'c41_color_negative') {
      context.addIssue({
        code: 'custom',
        message: 'Color negative stock metadata must use C-41 process family.',
        path: ['processFamily'],
      });
    }

    if (entry.stockClass === 'black_and_white_negative' && entry.processFamily !== 'black_and_white_silver_negative') {
      context.addIssue({
        code: 'custom',
        message: 'Black-and-white stock metadata must use silver-negative process family.',
        path: ['processFamily'],
      });
    }

    if (entry.stockClass === 'slide_reversal' && entry.processFamily !== 'e6_slide_reversal') {
      context.addIssue({
        code: 'custom',
        message: 'Slide metadata must use E-6 reversal process family.',
        path: ['processFamily'],
      });
    }

    if (entry.stockClass === 'cinema_negative' && entry.processFamily !== 'ecn2_cinema_negative') {
      context.addIssue({
        code: 'custom',
        message: 'Cinema negative stock metadata must use ECN-2 process family.',
        path: ['processFamily'],
      });
    }
  });

export const negativeLabStockMetadataCatalogSchema = z
  .object({
    catalogId: z.literal('negative_lab_stock_metadata_catalog'),
    entries: z.array(negativeLabStockMetadataEntrySchema).min(1),
    generatedFrom: z.literal('src/data/negativeLabStockMetadataCatalog.json'),
    schemaVersion: z.literal(NEGATIVE_LAB_STOCK_METADATA_CATALOG_SCHEMA_VERSION),
    version: z.string().trim().min(1),
  })
  .strict()
  .superRefine((catalog, context) => {
    const entryIds = new Set<string>();
    const displayNames = new Set<string>();
    const requiredClasses = [
      'black_and_white_negative',
      'cinema_negative',
      'color_negative',
      'slide_reversal',
    ] as const;

    for (const [index, entry] of catalog.entries.entries()) {
      if (entryIds.has(entry.entryId)) {
        context.addIssue({ code: 'custom', message: 'Duplicate stock metadata entry id.', path: ['entries', index] });
      }
      entryIds.add(entry.entryId);

      const displayName = entry.displayName.toLocaleLowerCase('en-US');
      if (displayNames.has(displayName)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate stock metadata display name.',
          path: ['entries', index, 'displayName'],
        });
      }
      displayNames.add(displayName);
    }

    for (const requiredClass of requiredClasses) {
      if (!catalog.entries.some((entry) => entry.stockClass === requiredClass)) {
        context.addIssue({
          code: 'custom',
          message: `Stock metadata catalog requires ${requiredClass} coverage.`,
          path: ['entries'],
        });
      }
    }
  });

export type NegativeLabStockMetadataCatalog = z.infer<typeof negativeLabStockMetadataCatalogSchema>;
export type NegativeLabStockMetadataEntry = z.infer<typeof negativeLabStockMetadataEntrySchema>;

export const parseNegativeLabStockMetadataCatalog = (value: unknown): NegativeLabStockMetadataCatalog =>
  negativeLabStockMetadataCatalogSchema.parse(value);
