import { z } from 'zod';

export const exportRecipeFileFormatV1Schema = z.enum(['avif', 'cube', 'jpeg', 'jxl', 'png', 'tiff', 'webp']);
export const exportRecipeColorProfileV1Schema = z.enum([
  'srgb',
  'displayP3',
  'adobeRgb1998',
  'proPhotoRgb',
  'sourceEmbedded',
]);
export const exportRecipeRenderingIntentV1Schema = z.enum([
  'absoluteColorimetric',
  'perceptual',
  'relativeColorimetric',
  'saturation',
]);
export const exportRecipeResizeModeV1Schema = z.enum(['longEdge', 'shortEdge', 'width', 'height']);
export const exportRecipeWatermarkAnchorV1Schema = z.enum([
  'topLeft',
  'topCenter',
  'topRight',
  'centerLeft',
  'center',
  'centerRight',
  'bottomLeft',
  'bottomCenter',
  'bottomRight',
]);
export const exportRecipeOutputSharpeningV1Schema = z
  .object({
    amount: z.number().min(0).max(100),
    radiusPx: z.number().min(0.3).max(3),
    target: z.enum(['custom', 'print', 'screen']),
    threshold: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.target === 'print' && settings.amount > 0 && settings.radiusPx < 0.8) {
      context.addIssue({
        code: 'custom',
        message: 'Print output sharpening requires radiusPx >= 0.8.',
        path: ['radiusPx'],
      });
    }

    if (settings.amount === 0 && settings.threshold > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Disabled output sharpening must use threshold 0.',
        path: ['threshold'],
      });
    }
  });

export const exportRecipeV1Schema = z
  .object({
    blackPointCompensation: z.boolean(),
    colorProfile: exportRecipeColorProfileV1Schema,
    dontEnlarge: z.boolean(),
    enableResize: z.boolean(),
    enableWatermark: z.boolean(),
    exportMasks: z.boolean(),
    fileFormat: exportRecipeFileFormatV1Schema,
    filenameTemplate: z.string().trim().min(1),
    id: z.string().trim().min(1),
    jpegQuality: z.number().int().min(1).max(100),
    keepMetadata: z.boolean(),
    lastExportPath: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    outputSharpening: exportRecipeOutputSharpeningV1Schema.nullable(),
    preserveFolders: z.boolean(),
    preserveTimestamps: z.boolean(),
    renderingIntent: exportRecipeRenderingIntentV1Schema,
    resizeMode: exportRecipeResizeModeV1Schema,
    resizeValue: z.number().int().min(1).max(100_000),
    stripGps: z.boolean(),
    watermarkAnchor: exportRecipeWatermarkAnchorV1Schema,
    watermarkOpacity: z.number().int().min(0).max(100),
    watermarkPath: z.string().trim().min(1).nullable(),
    watermarkScale: z.number().int().min(1).max(100),
    watermarkSpacing: z.number().int().min(0).max(100),
  })
  .strict()
  .superRefine((recipe, context) => {
    if (recipe.colorProfile === 'sourceEmbedded' && recipe.fileFormat !== 'jpeg' && recipe.fileFormat !== 'tiff') {
      context.addIssue({
        code: 'custom',
        message: 'Source-embedded profile export is only available for JPEG and TIFF recipes.',
        path: ['colorProfile'],
      });
    }

    if (recipe.colorProfile === 'sourceEmbedded' && recipe.renderingIntent !== 'relativeColorimetric') {
      context.addIssue({
        code: 'custom',
        message: 'Source-embedded profile export requires relative colorimetric rendering intent.',
        path: ['renderingIntent'],
      });
    }

    if (recipe.colorProfile === 'sourceEmbedded' && recipe.blackPointCompensation) {
      context.addIssue({
        code: 'custom',
        message: 'Source-embedded profile export does not support black-point compensation.',
        path: ['blackPointCompensation'],
      });
    }

    if (recipe.fileFormat !== 'jpeg' && recipe.jpegQuality !== 100) {
      context.addIssue({
        code: 'custom',
        message: 'Non-JPEG export recipes must use jpegQuality 100 as a no-op value.',
        path: ['jpegQuality'],
      });
    }

    if (recipe.enableWatermark && recipe.watermarkPath === null) {
      context.addIssue({
        code: 'custom',
        message: 'Watermark-enabled export recipes require watermarkPath.',
        path: ['watermarkPath'],
      });
    }
  });

export const exportRecipeListV1Schema = z.array(exportRecipeV1Schema);

export const exportRecipeCatalogV1Schema = z
  .object({
    recipeRevision: z.string().trim().min(1),
    recipes: exportRecipeListV1Schema,
  })
  .strict()
  .superRefine((catalog, context) => {
    const recipeIds = new Set(catalog.recipes.map((recipe) => recipe.id));
    if (recipeIds.size !== catalog.recipes.length) {
      context.addIssue({
        code: 'custom',
        message: 'Export recipe catalog must not contain duplicate recipe ids.',
        path: ['recipes'],
      });
    }
  });

export const exportRecipeUpsertCommandV1Schema = z
  .object({
    commandId: z.string().trim().min(1),
    commandType: z.literal('exportRecipe.upsert'),
    dryRun: z.boolean(),
    expectedRecipeRevision: z.string().trim().min(1),
    recipe: exportRecipeV1Schema,
  })
  .strict();

export const exportRecipeUpsertResultV1Schema = z
  .object({
    commandId: z.string().trim().min(1),
    commandType: z.literal('exportRecipe.upsert'),
    dryRun: z.boolean(),
    mutates: z.boolean(),
    recipeId: z.string().trim().min(1),
    recipeRevision: z.string().trim().min(1),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict();

export type ExportRecipeV1 = z.infer<typeof exportRecipeV1Schema>;
export type ExportRecipeListV1 = z.infer<typeof exportRecipeListV1Schema>;
export type ExportRecipeCatalogV1 = z.infer<typeof exportRecipeCatalogV1Schema>;
export type ExportRecipeUpsertCommandV1 = z.infer<typeof exportRecipeUpsertCommandV1Schema>;
export type ExportRecipeUpsertResultV1 = z.infer<typeof exportRecipeUpsertResultV1Schema>;

export const parseExportRecipeV1 = (value: unknown): ExportRecipeV1 => exportRecipeV1Schema.parse(value);
export const parseExportRecipesV1 = (value: unknown): ExportRecipeListV1 => exportRecipeListV1Schema.parse(value);

export const upsertExportRecipeV1 = (
  catalogValue: unknown,
  commandValue: unknown,
): { catalog: ExportRecipeCatalogV1; result: ExportRecipeUpsertResultV1 } => {
  const catalog = exportRecipeCatalogV1Schema.parse(catalogValue);
  const command = exportRecipeUpsertCommandV1Schema.parse(commandValue);
  if (catalog.recipeRevision !== command.expectedRecipeRevision) {
    throw new Error('Export recipe upsert expectedRecipeRevision does not match catalog revision.');
  }

  const nextRecipes = catalog.recipes.filter((recipe) => recipe.id !== command.recipe.id);
  nextRecipes.push(command.recipe);
  nextRecipes.sort((left, right) => left.id.localeCompare(right.id));
  const recipeRevision = `${catalog.recipeRevision}:recipe:${command.recipe.id}`;

  return {
    catalog: exportRecipeCatalogV1Schema.parse({
      recipeRevision,
      recipes: command.dryRun ? catalog.recipes : nextRecipes,
    }),
    result: exportRecipeUpsertResultV1Schema.parse({
      commandId: command.commandId,
      commandType: command.commandType,
      dryRun: command.dryRun,
      mutates: !command.dryRun,
      recipeId: command.recipe.id,
      recipeRevision,
      warnings: [],
    }),
  };
};
