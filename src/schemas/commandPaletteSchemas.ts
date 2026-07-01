import { z } from 'zod';

export const commandPaletteCommandIdSchema = z.enum([
  'backToLibrary',
  'collage',
  'copyPasteSettings',
  'culling',
  'denoise',
  'focusStack',
  'hdrMerge',
  'importFiles',
  'lensCorrection',
  'negativeLab',
  'panorama',
  'panelAdjustments',
  'panelAi',
  'panelColor',
  'panelCrop',
  'panelExport',
  'panelMasks',
  'panelMetadata',
  'panelPresets',
  'panelTether',
  'superResolution',
  'transformTools',
]);

export type CommandPaletteCommandId = z.infer<typeof commandPaletteCommandIdSchema>;

export const commandPaletteCommandCategorySchema = z.enum(['merge', 'navigation', 'panels', 'workflow']);

export type CommandPaletteCommandCategory = z.infer<typeof commandPaletteCommandCategorySchema>;

export const commandPaletteCommandSchema = z
  .object({
    category: commandPaletteCommandCategorySchema,
    id: commandPaletteCommandIdSchema,
    requiresEditorImage: z.boolean().default(false),
    searchTokens: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type CommandPaletteCommand = z.infer<typeof commandPaletteCommandSchema>;
