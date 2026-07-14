import { z } from 'zod';

import { negativeLabAcquisitionProfileIdSchema } from './negativeLabAcquisitionProfileSchemas';
import { negativeLabPresetIdSchema, negativeLabPresetParamsSchema } from './negativeLabPresetCatalogSchemas';
import { negativeLabSessionSaveOptionsSchema } from './negativeLabSessionStateSchemas';

export const NEGATIVE_LAB_NAMED_RECIPE_SCHEMA_VERSION = 1;

const negativeLabNamedRecipeIdSchema = z
  .string()
  .trim()
  .regex(/^negative_lab\.recipe\.[a-z0-9_-]+\.v[0-9]+$/u);

export const negativeLabNamedRecipeSchema = z
  .object({
    contentHash: z.string().regex(/^fnv1a32:[0-9a-f]{8}$/u),
    createdAt: z.string().datetime({ offset: true }),
    id: negativeLabNamedRecipeIdSchema,
    name: z.string().trim().min(1).max(80),
    params: negativeLabPresetParamsSchema,
    profileSnapshot: z.record(z.string(), z.unknown()).nullable(),
    provenance: z
      .object({
        sourceSessionId: z.string().trim().min(1),
        sourceSpecificValuesOmitted: z.array(z.string().trim().min(1)),
      })
      .strict(),
    saveOptions: negativeLabSessionSaveOptionsSchema,
    selectedAcquisitionProfileId: negativeLabAcquisitionProfileIdSchema,
    selectedPresetId: z.union([negativeLabPresetIdSchema, z.literal('')]),
    version: z.literal(NEGATIVE_LAB_NAMED_RECIPE_SCHEMA_VERSION),
  })
  .strict();

export const negativeLabNamedRecipeLibrarySchema = z
  .object({
    recipes: z.array(negativeLabNamedRecipeSchema),
    version: z.literal(NEGATIVE_LAB_NAMED_RECIPE_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((library, context) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const [index, recipe] of library.recipes.entries()) {
      if (ids.has(recipe.id))
        context.addIssue({ code: 'custom', message: 'Duplicate recipe id.', path: ['recipes', index, 'id'] });
      if (names.has(recipe.name.toLocaleLowerCase('en-US'))) {
        context.addIssue({ code: 'custom', message: 'Duplicate recipe name.', path: ['recipes', index, 'name'] });
      }
      ids.add(recipe.id);
      names.add(recipe.name.toLocaleLowerCase('en-US'));
    }
  });

export type NegativeLabNamedRecipe = z.infer<typeof negativeLabNamedRecipeSchema>;
export type NegativeLabNamedRecipeLibrary = z.infer<typeof negativeLabNamedRecipeLibrarySchema>;

export const parseNegativeLabNamedRecipeLibrary = (value: unknown): NegativeLabNamedRecipeLibrary =>
  negativeLabNamedRecipeLibrarySchema.parse(value);
