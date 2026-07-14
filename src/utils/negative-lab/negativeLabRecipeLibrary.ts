import {
  type NegativeLabNamedRecipe,
  type NegativeLabNamedRecipeLibrary,
  negativeLabNamedRecipeSchema,
  parseNegativeLabNamedRecipeLibrary,
} from '../../schemas/negative-lab/negativeLabRecipeSchemas';
import type { NegativeLabSessionSaveOptions } from '../../schemas/negative-lab/negativeLabSessionStateSchemas';
import { buildNegativeLabPlanHash } from './negativeLabPlanIdentity';
import type { NegativeLabSessionSnapshot } from './negativeLabSessionState';
import { updateNegativeLabSessionRecipe } from './negativeLabSessionState';

export type NegativeLabRecipeScope = 'active' | 'all' | 'ready' | 'included';

export interface NegativeLabNamedRecipeInput {
  name: string;
  params: NegativeLabNamedRecipe['params'];
  profileSnapshot: Record<string, unknown> | null;
  saveOptions: NegativeLabSessionSaveOptions;
  selectedAcquisitionProfileId: NegativeLabNamedRecipe['selectedAcquisitionProfileId'];
  selectedPresetId: NegativeLabNamedRecipe['selectedPresetId'];
  sourceSessionId: string;
  sourceSpecificValuesOmitted?: readonly string[];
}

export interface NegativeLabRecipeStore {
  read: () => Promise<unknown>;
  write: (library: NegativeLabNamedRecipeLibrary) => Promise<void>;
}

export interface NegativeLabRecipeCompatibility {
  blocked: boolean;
  reasons: string[];
}

export const EMPTY_NEGATIVE_LAB_NAMED_RECIPE_LIBRARY: NegativeLabNamedRecipeLibrary = {
  recipes: [],
  version: 1,
};

const normalizeName = (name: string): string => name.trim().replace(/\s+/gu, ' ');

const recipeContent = (input: NegativeLabNamedRecipeInput): string =>
  JSON.stringify({
    params: input.params,
    profileSnapshot: input.profileSnapshot,
    saveOptions: input.saveOptions,
    selectedAcquisitionProfileId: input.selectedAcquisitionProfileId,
    selectedPresetId: input.selectedPresetId,
    sourceSpecificValuesOmitted: [...(input.sourceSpecificValuesOmitted ?? [])].sort(),
  });

export const createNegativeLabNamedRecipe = (
  input: NegativeLabNamedRecipeInput,
  now = new Date(),
): NegativeLabNamedRecipe => {
  const name = normalizeName(input.name);
  if (name.length === 0) throw new Error('negative_lab.recipe_name_required');
  const contentHash = `fnv1a32:${buildNegativeLabPlanHash(recipeContent(input))}` as const;
  const id = `negative_lab.recipe.${contentHash.slice('fnv1a32:'.length)}.v1` as const;
  return negativeLabNamedRecipeSchema.parse({
    contentHash,
    createdAt: now.toISOString(),
    id,
    name,
    params: input.params,
    profileSnapshot: input.profileSnapshot,
    provenance: {
      sourceSessionId: input.sourceSessionId,
      sourceSpecificValuesOmitted: [...(input.sourceSpecificValuesOmitted ?? [])],
    },
    saveOptions: input.saveOptions,
    selectedAcquisitionProfileId: input.selectedAcquisitionProfileId,
    selectedPresetId: input.selectedPresetId,
    version: 1,
  });
};

export const loadNegativeLabNamedRecipeLibrary = async (
  store: NegativeLabRecipeStore,
): Promise<NegativeLabNamedRecipeLibrary> => {
  const raw = await store.read();
  if (raw === null || raw === undefined) return EMPTY_NEGATIVE_LAB_NAMED_RECIPE_LIBRARY;
  try {
    return parseNegativeLabNamedRecipeLibrary(raw);
  } catch {
    // Corrupt app-data must not prevent the editor from starting or write partial data back.
    return EMPTY_NEGATIVE_LAB_NAMED_RECIPE_LIBRARY;
  }
};

export const saveNegativeLabNamedRecipe = (
  library: NegativeLabNamedRecipeLibrary,
  recipe: NegativeLabNamedRecipe,
): NegativeLabNamedRecipeLibrary => {
  if (library.recipes.some((entry) => entry.id === recipe.id)) throw new Error('negative_lab.recipe_id_exists');
  if (
    library.recipes.some((entry) => entry.name.toLocaleLowerCase('en-US') === recipe.name.toLocaleLowerCase('en-US'))
  ) {
    throw new Error('negative_lab.recipe_name_exists');
  }
  return parseNegativeLabNamedRecipeLibrary({ ...library, recipes: [...library.recipes, recipe] });
};

export const renameNegativeLabNamedRecipe = (
  library: NegativeLabNamedRecipeLibrary,
  recipeId: string,
  name: string,
): NegativeLabNamedRecipeLibrary => {
  const normalizedName = normalizeName(name);
  if (normalizedName.length === 0) throw new Error('negative_lab.recipe_name_required');
  if (
    library.recipes.some(
      (entry) =>
        entry.id !== recipeId && entry.name.toLocaleLowerCase('en-US') === normalizedName.toLocaleLowerCase('en-US'),
    )
  ) {
    throw new Error('negative_lab.recipe_name_exists');
  }
  const recipes = library.recipes.map((entry) => (entry.id === recipeId ? { ...entry, name: normalizedName } : entry));
  if (recipes.every((entry, index) => entry === library.recipes[index]))
    throw new Error('negative_lab.recipe_not_found');
  return parseNegativeLabNamedRecipeLibrary({ ...library, recipes });
};

export const deleteNegativeLabNamedRecipe = (
  library: NegativeLabNamedRecipeLibrary,
  recipeId: string,
): NegativeLabNamedRecipeLibrary => {
  const recipes = library.recipes.filter((entry) => entry.id !== recipeId);
  if (recipes.length === library.recipes.length) throw new Error('negative_lab.recipe_not_found');
  return parseNegativeLabNamedRecipeLibrary({ ...library, recipes });
};

export const resolveNegativeLabRecipeScope = (
  snapshot: NegativeLabSessionSnapshot,
  scope: NegativeLabRecipeScope,
): string[] => {
  const { activePath, frameStateByPath, targetPaths } = snapshot.session;
  if (scope === 'active') return activePath === null ? [] : [activePath];
  if (scope === 'all') return [...targetPaths];
  return targetPaths.filter((path) => {
    const frame = frameStateByPath[path];
    if (scope === 'included') return frame?.included ?? true;
    return (frame?.included ?? true) && frame?.qcDecision !== 'rejected';
  });
};

export const checkNegativeLabRecipeCompatibility = (
  recipe: NegativeLabNamedRecipe,
  current: Pick<NegativeLabNamedRecipeInput, 'selectedAcquisitionProfileId' | 'selectedPresetId'>,
): NegativeLabRecipeCompatibility => {
  const reasons: string[] = [];
  if (recipe.selectedAcquisitionProfileId !== current.selectedAcquisitionProfileId)
    reasons.push('acquisition_profile_mismatch');
  if (
    recipe.selectedPresetId !== '' &&
    current.selectedPresetId !== '' &&
    recipe.selectedPresetId !== current.selectedPresetId
  ) {
    reasons.push('preset_mismatch');
  }
  if (recipe.provenance.sourceSpecificValuesOmitted.length > 0)
    reasons.push('source_specific_values_require_confirmation');
  return { blocked: reasons.includes('acquisition_profile_mismatch'), reasons };
};

export const applyNegativeLabNamedRecipe = (
  snapshot: NegativeLabSessionSnapshot,
  recipe: NegativeLabNamedRecipe,
  scope: NegativeLabRecipeScope,
  current: Pick<NegativeLabNamedRecipeInput, 'selectedAcquisitionProfileId' | 'selectedPresetId'>,
): { snapshot: NegativeLabSessionSnapshot; affectedPaths: string[]; compatibility: NegativeLabRecipeCompatibility } => {
  const compatibility = checkNegativeLabRecipeCompatibility(recipe, current);
  if (compatibility.blocked) return { snapshot, affectedPaths: [], compatibility };
  const affectedPaths = resolveNegativeLabRecipeScope(snapshot, scope);
  if (affectedPaths.length === 0) return { snapshot, affectedPaths, compatibility };
  const next = updateNegativeLabSessionRecipe(snapshot, (recipeState) => ({
    ...recipeState,
    params: recipe.params,
    saveOptions: recipe.saveOptions,
    selectedAcquisitionProfileId: recipe.selectedAcquisitionProfileId,
    selectedPresetId: recipe.selectedPresetId,
  }));
  const clearedPlanState = {
    ...next.session.planState,
    acceptedApplyPlanFingerprint: null,
    acceptedSessionRevision: null,
  };
  return {
    affectedPaths,
    compatibility,
    snapshot: {
      ...next,
      planState: clearedPlanState,
      session: { ...next.session, planState: clearedPlanState },
    },
  };
};

export const persistNegativeLabNamedRecipeLibrary = async (
  store: NegativeLabRecipeStore,
  update: (library: NegativeLabNamedRecipeLibrary) => NegativeLabNamedRecipeLibrary,
): Promise<NegativeLabNamedRecipeLibrary> => {
  const current = await loadNegativeLabNamedRecipeLibrary(store);
  const next = parseNegativeLabNamedRecipeLibrary(update(current));
  await store.write(next);
  return next;
};
