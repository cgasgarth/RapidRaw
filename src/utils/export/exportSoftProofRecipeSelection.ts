import type { ExportPreset } from '../../components/ui/ExportImportProperties';

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
  presets: readonly ExportPreset[];
  requestedRecipeId: string | null;
}): ResolvedExportSoftProofRecipe => {
  const recipeIds = presets.filter((preset) => preset.fileFormat !== 'cube').map((preset) => preset.id);
  const requestedIsValid = requestedRecipeId !== null && recipeIds.includes(requestedRecipeId);
  const recipeId = requestedIsValid ? requestedRecipeId : (recipeIds[0] ?? null);
  if (recipeId === null) return { enabled: false, recipeId: null, status: 'unavailable' };
  if (!enabled) return { enabled: false, recipeId, status: 'disabled' };
  return { enabled: true, recipeId, status: requestedIsValid ? 'enabled' : 'fallback' };
};
