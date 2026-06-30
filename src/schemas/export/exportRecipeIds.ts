export const EXPORT_LAST_USED_PRESET_ID = '__last_used__';

export const BUILT_IN_EXPORT_RECIPE_IDS = ['default-hq', 'default-fast', 'client-proof-tiff'] as const;
export const CLIENT_PROOF_TIFF_EXPORT_RECIPE_ID = 'client-proof-tiff';

export type BuiltInExportRecipeId = (typeof BUILT_IN_EXPORT_RECIPE_IDS)[number];
