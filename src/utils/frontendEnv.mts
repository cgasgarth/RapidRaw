type RawEngineImportMetaEnv = ImportMetaEnv & {
  VITE_CLERK_PUBLISHABLE_KEY?: string | undefined;
};

export const getViteEnv = (): RawEngineImportMetaEnv => import.meta.env;
