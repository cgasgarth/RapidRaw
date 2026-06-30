import { z } from 'zod';
import { EXPORT_RECIPE_FILE_FORMAT_IDS, ExportFileFormatId } from '../utils/export/exportFormatIds';
import { outputSharpeningSettingsSchema } from './outputSharpeningSchemas';

export const exportFileFormatSchema = z.enum(EXPORT_RECIPE_FILE_FORMAT_IDS);
export const exportColorProfileSchema = z.enum(['srgb', 'displayP3', 'adobeRgb1998', 'proPhotoRgb', 'sourceEmbedded']);
export const exportRenderingIntentSchema = z.enum([
  'absoluteColorimetric',
  'perceptual',
  'relativeColorimetric',
  'saturation',
]);
export const exportResizeModeSchema = z.enum(['longEdge', 'shortEdge', 'width', 'height']);
export const watermarkAnchorSchema = z.enum([
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

export const exportRecipeSchema = z
  .object({
    blackPointCompensation: z.boolean().default(false),
    colorProfile: exportColorProfileSchema.default('srgb'),
    dontEnlarge: z.boolean(),
    enableResize: z.boolean(),
    enableWatermark: z.boolean(),
    exportMasks: z.boolean().default(false),
    fileFormat: exportFileFormatSchema,
    filenameTemplate: z.string().trim().min(1),
    id: z.string().trim().min(1),
    jpegQuality: z.number().int().min(1).max(100),
    keepMetadata: z.boolean(),
    lastExportPath: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    outputSharpening: outputSharpeningSettingsSchema.nullable().default(null),
    preserveFolders: z.boolean().default(false),
    preserveTimestamps: z.boolean().default(false),
    renderingIntent: exportRenderingIntentSchema.default('relativeColorimetric'),
    resizeMode: exportResizeModeSchema,
    resizeValue: z.number().int().min(1).max(100_000),
    stripGps: z.boolean(),
    watermarkAnchor: watermarkAnchorSchema,
    watermarkOpacity: z.number().int().min(0).max(100),
    watermarkPath: z.string().trim().min(1).nullable(),
    watermarkScale: z.number().int().min(1).max(100),
    watermarkSpacing: z.number().int().min(0).max(100),
  })
  .strict()
  .superRefine((recipe, context) => {
    if (recipe.fileFormat !== ExportFileFormatId.Jpeg && recipe.jpegQuality !== 100) {
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

export const exportRecipeListSchema = z.array(exportRecipeSchema);

export type ExportRecipe = z.infer<typeof exportRecipeSchema>;
export type ExportRecipeList = z.infer<typeof exportRecipeListSchema>;

export const parseExportRecipe = (value: unknown): ExportRecipe => exportRecipeSchema.parse(value);
export const parseExportRecipes = (value: unknown): ExportRecipeList => exportRecipeListSchema.parse(value);
