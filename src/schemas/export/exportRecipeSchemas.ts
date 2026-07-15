import { z } from 'zod';
import { EXPORT_RECIPE_FILE_FORMAT_IDS, ExportFileFormatId } from '../../utils/export/exportFormatIds';
import { outputSharpeningSettingsSchema } from '../outputSharpeningSchemas';

const exportFileFormatSchema = z.enum(EXPORT_RECIPE_FILE_FORMAT_IDS);
const exportColorProfileSchema = z.enum(['srgb', 'displayP3', 'adobeRgb1998', 'proPhotoRgb', 'sourceEmbedded']);
const exportRenderingIntentSchema = z.enum([
  'absoluteColorimetric',
  'perceptual',
  'relativeColorimetric',
  'saturation',
]);
export const exportResizeModeSchema = z.enum(['longEdge', 'shortEdge', 'width', 'height']);
const watermarkAnchorSchema = z.enum([
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
    blackPointCompensation: z.boolean(),
    colorProfile: exportColorProfileSchema,
    dontEnlarge: z.boolean(),
    enableResize: z.boolean(),
    enableWatermark: z.boolean(),
    exportMasks: z.boolean(),
    fileFormat: exportFileFormatSchema,
    filenameTemplate: z.string().trim().min(1),
    id: z.string().trim().min(1),
    jpegQuality: z.number().int().min(1).max(100),
    keepMetadata: z.boolean(),
    lastExportPath: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    outputSharpening: outputSharpeningSettingsSchema.nullable(),
    preserveFolders: z.boolean(),
    preserveTimestamps: z.boolean(),
    renderingIntent: exportRenderingIntentSchema,
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
    if (
      recipe.colorProfile === 'sourceEmbedded' &&
      recipe.fileFormat !== ExportFileFormatId.Jpeg &&
      recipe.fileFormat !== ExportFileFormatId.Tiff
    ) {
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

const exportRecipeListSchema = z.array(exportRecipeSchema);

export type ExportRecipe = z.infer<typeof exportRecipeSchema>;
export type ExportRecipeList = z.infer<typeof exportRecipeListSchema>;
export type ExportRecipeSettings = Omit<ExportRecipe, 'id' | 'lastExportPath' | 'name'>;

export const parseExportRecipe = (value: unknown): ExportRecipe => exportRecipeSchema.parse(value);
export const parseExportRecipes = (value: unknown): ExportRecipeList => exportRecipeListSchema.parse(value);

export const buildCurrentExportRecipe = ({
  id,
  lastExportPath,
  name,
  settings,
}: {
  id: string;
  lastExportPath?: string;
  name: string;
  settings: ExportRecipeSettings;
}): ExportRecipe =>
  exportRecipeSchema.parse({
    ...settings,
    id,
    jpegQuality: settings.fileFormat === ExportFileFormatId.Jpeg ? settings.jpegQuality : 100,
    ...(lastExportPath === undefined ? {} : { lastExportPath }),
    name,
  });

export const findCurrentExportRecipe = (values: readonly unknown[], id: string): ExportRecipe | null => {
  for (const value of values) {
    const parsed = exportRecipeSchema.safeParse(value);
    if (parsed.success && parsed.data.id === id) return parsed.data;
  }
  return null;
};

const exportRecipeIdentitySchema = z.object({ id: z.string().trim().min(1) }).loose();

export const withoutExportRecipeId = (values: readonly unknown[], id: string): Array<unknown> =>
  values.filter((value) => {
    const identity = exportRecipeIdentitySchema.safeParse(value);
    return !identity.success || identity.data.id !== id;
  });
