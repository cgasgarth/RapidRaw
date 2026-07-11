type RawEngineImportMetaEnv = ImportMetaEnv & {
  DEV: boolean;
  MODE: string;
  VITE_CLERK_PUBLISHABLE_KEY?: string | undefined;
};

export const getViteEnv = (): RawEngineImportMetaEnv => import.meta.env as RawEngineImportMetaEnv;
