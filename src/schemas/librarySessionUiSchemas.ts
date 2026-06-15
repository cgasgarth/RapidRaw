import { z } from 'zod';

import { librarySessionWorkflowStageSchema } from './librarySessionSchemas';

export const librarySessionUiSummarySchema = z
  .object({
    assetCount: z.number().int().nonnegative(),
    exportRecipeCount: z.number().int().nonnegative(),
    folderPath: z.string().trim().min(1).nullable(),
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    selectedCount: z.number().int().nonnegative(),
    stage: librarySessionWorkflowStageSchema,
  })
  .strict();

export const librarySessionUiCardSchema = z
  .object({
    assetLabel: z.string().trim().min(1),
    folderLabel: z.string().trim().min(1),
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    recipeLabel: z.string().trim().min(1),
    selectedLabel: z.string().trim().min(1),
    stage: librarySessionWorkflowStageSchema,
  })
  .strict();

export type LibrarySessionUiSummary = z.infer<typeof librarySessionUiSummarySchema>;
export type LibrarySessionUiCard = z.infer<typeof librarySessionUiCardSchema>;

export const buildLibrarySessionUiCard = (value: LibrarySessionUiSummary): LibrarySessionUiCard => {
  const summary = librarySessionUiSummarySchema.parse(value);
  return librarySessionUiCardSchema.parse({
    assetLabel: `${summary.assetCount} assets`,
    folderLabel: summary.folderPath ?? 'No active folder',
    id: summary.id,
    name: summary.name,
    recipeLabel: `${summary.exportRecipeCount} recipes`,
    selectedLabel: `${summary.selectedCount} selected`,
    stage: summary.stage,
  });
};
