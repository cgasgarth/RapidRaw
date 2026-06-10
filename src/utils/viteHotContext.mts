type ViteHotContext = {
  on(event: string, callback: (payload: unknown) => void): void;
};

type ViteImportMeta = ImportMeta & {
  hot?: ViteHotContext;
};

export function onViteError(callback: (payload: unknown) => void): void {
  (import.meta as ViteImportMeta).hot?.on('vite:error', callback);
}
