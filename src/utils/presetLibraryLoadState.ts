export interface PresetLibraryLoadState {
  fatalLoadError: string | null;
  quarantineNotice: string | null;
}

export const classifyPresetLibraryLoadState = (loadError: string | null): PresetLibraryLoadState => {
  const quarantineNotice = loadError?.startsWith('Quarantined ') === true ? loadError : null;
  return {
    fatalLoadError: loadError !== null && quarantineNotice === null ? loadError : null,
    quarantineNotice,
  };
};
