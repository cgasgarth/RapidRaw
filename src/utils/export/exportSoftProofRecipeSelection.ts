import { exportRecipeSchema } from '../../schemas/export/exportRecipeSchemas';

export type ExportSoftProofRecipeStatus = 'disabled' | 'enabled' | 'fallback' | 'unavailable';

export interface ResolvedExportSoftProofRecipe {
  enabled: boolean;
  recipeId: string | null;
  status: ExportSoftProofRecipeStatus;
}

export const resolveExportSoftProofRecipe = ({
  enabled,
  presets,
  requestedRecipeId,
}: {
  enabled: boolean;
  presets: readonly unknown[];
  requestedRecipeId: string | null;
}): ResolvedExportSoftProofRecipe => {
  const recipeIds = presets.flatMap((preset) => {
    const parsed = exportRecipeSchema.safeParse(preset);
    return parsed.success && parsed.data.fileFormat !== 'cube' ? [parsed.data.id] : [];
  });
  const requestedIsValid = requestedRecipeId !== null && recipeIds.includes(requestedRecipeId);
  const recipeId = requestedIsValid ? requestedRecipeId : (recipeIds[0] ?? null);
  if (recipeId === null) return { enabled: false, recipeId: null, status: 'unavailable' };
  if (!enabled) return { enabled: false, recipeId, status: 'disabled' };
  return { enabled: true, recipeId, status: requestedIsValid ? 'enabled' : 'fallback' };
};
