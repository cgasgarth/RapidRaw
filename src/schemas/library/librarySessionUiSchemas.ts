import { z } from 'zod';

import { type LibrarySession, librarySessionSchema, librarySessionWorkflowStageSchema } from './librarySessionSchemas';

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

export const librarySessionWorkflowBlockerSchema = z.enum([
  'missing_export_recipe',
  'no_recent_assets',
  'no_selection',
]);
export const librarySessionWorkflowActionSchema = z.enum([
  'configure_export',
  'continue_editing',
  'review_selection',
  'run_export',
  'select_assets',
]);
export const librarySessionWorkflowPlanSchema = z
  .object({
    blockers: z.array(librarySessionWorkflowBlockerSchema),
    canExportSelection: z.boolean(),
    id: z.string().trim().min(1),
    nextAction: librarySessionWorkflowActionSchema,
    selectedCount: z.number().int().nonnegative(),
    stage: librarySessionWorkflowStageSchema,
  })
  .strict();

export type LibrarySessionUiSummary = z.infer<typeof librarySessionUiSummarySchema>;
export type LibrarySessionUiCard = z.infer<typeof librarySessionUiCardSchema>;
export type LibrarySessionWorkflowPlan = z.infer<typeof librarySessionWorkflowPlanSchema>;

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

export const buildLibrarySessionUiSummary = (value: LibrarySession): LibrarySessionUiSummary => {
  const session = librarySessionSchema.parse(value);
  return librarySessionUiSummarySchema.parse({
    assetCount: session.recentAssetPaths.length,
    exportRecipeCount: session.exportRecipeIds.length,
    folderPath: session.activeFolderPath,
    id: session.id,
    name: session.name,
    selectedCount: session.selectedAssetPaths.length,
    stage: session.workflowStage,
  });
};

export const buildLibrarySessionWorkflowPlan = (value: LibrarySession): LibrarySessionWorkflowPlan => {
  const session = librarySessionSchema.parse(value);
  const blockers: Array<z.infer<typeof librarySessionWorkflowBlockerSchema>> = [];

  if (session.recentAssetPaths.length === 0) {
    blockers.push('no_recent_assets');
  }

  if (session.selectedAssetPaths.length === 0) {
    blockers.push('no_selection');
  }

  if (session.exportRecipeIds.length === 0) {
    blockers.push('missing_export_recipe');
  }

  const canExportSelection = blockers.length === 0;
  const nextAction = (() => {
    if (blockers.includes('no_recent_assets') || blockers.includes('no_selection')) {
      return 'select_assets';
    }

    if (blockers.includes('missing_export_recipe')) {
      return 'configure_export';
    }

    if (session.workflowStage === 'cull' || session.workflowStage === 'review') {
      return 'review_selection';
    }

    return canExportSelection ? 'run_export' : 'continue_editing';
  })();

  return librarySessionWorkflowPlanSchema.parse({
    blockers,
    canExportSelection,
    id: session.id,
    nextAction,
    selectedCount: session.selectedAssetPaths.length,
    stage: session.workflowStage,
  });
};
