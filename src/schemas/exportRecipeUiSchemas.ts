import { z } from 'zod';

import { BUILT_IN_EXPORT_RECIPE_IDS, EXPORT_LAST_USED_PRESET_ID } from './exportRecipeIds';
import { exportRecipeSchema, type ExportRecipe } from './exportRecipeSchemas';

export const exportRecipeUiRowSchema = z
  .object({
    id: z.string().trim().min(1),
    isBuiltIn: z.boolean(),
    isValidRecipe: z.boolean(),
    label: z.string().trim().min(1),
    metadataLabel: z.string().trim().min(1),
    resizeLabel: z.string().trim().min(1),
    settings: z.unknown(),
    subtitle: z.string().trim().min(1),
  })
  .strict();

export type ExportRecipeUiRow = z.infer<typeof exportRecipeUiRowSchema>;

const BUILT_IN_RECIPE_IDS: ReadonlySet<string> = new Set(BUILT_IN_EXPORT_RECIPE_IDS);

const recipeIdentitySchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
  })
  .loose();

const recipeObjectSchema = z.record(z.string(), z.unknown());

const normalizeLegacyBuiltInRecipe = (value: Record<string, unknown>): Record<string, unknown> => {
  const id = typeof value['id'] === 'string' ? value['id'] : '';
  if (!BUILT_IN_RECIPE_IDS.has(id)) return value;

  return {
    colorProfile: 'srgb',
    exportMasks: false,
    outputSharpening: null,
    preserveFolders: false,
    preserveTimestamps: false,
    renderingIntent: 'relativeColorimetric',
    watermarkAnchor: 'bottomRight',
    watermarkOpacity: 75,
    watermarkPath: null,
    watermarkScale: 10,
    watermarkSpacing: 5,
    ...value,
  };
};

const asRecipeLike = (value: unknown): ExportRecipe | null => {
  const recipeObject = recipeObjectSchema.safeParse(value);
  const parsed = exportRecipeSchema.safeParse(
    recipeObject.success ? normalizeLegacyBuiltInRecipe(recipeObject.data) : value,
  );
  return parsed.success ? parsed.data : null;
};

export const buildExportRecipeUiRows = (values: Array<unknown>): Array<ExportRecipeUiRow> =>
  values
    .filter((value) => {
      const identity = recipeIdentitySchema.safeParse(value);
      return identity.success && identity.data.id !== undefined && identity.data.id !== EXPORT_LAST_USED_PRESET_ID;
    })
    .map((value) => {
      const recipe = asRecipeLike(value);
      const identity = recipeIdentitySchema.safeParse(value).data;
      const id = identity?.id ?? 'invalid-recipe';
      const name = identity?.name ?? id;
      const fileFormat = recipe?.fileFormat.toUpperCase() ?? 'Custom';
      const resizeLabel = recipe?.enableResize ? `${recipe.resizeMode} ${recipe.resizeValue}px` : 'Original size';
      const metadataLabel = recipe?.keepMetadata ? (recipe.stripGps ? 'Metadata, no GPS' : 'Metadata') : 'No metadata';
      const subtitle = recipe
        ? `${fileFormat} | Q${recipe.jpegQuality} | ${resizeLabel}`
        : 'Custom recipe needs review';

      return exportRecipeUiRowSchema.parse({
        id,
        isBuiltIn: BUILT_IN_RECIPE_IDS.has(id),
        isValidRecipe: recipe !== null,
        label: name,
        metadataLabel,
        resizeLabel,
        settings: value,
        subtitle,
      });
    });
