export type FolderTreeSection = 'albums' | 'current' | 'pinned';

interface FolderTreeSearchMatches {
  albums: boolean;
  current: boolean;
  pinned: boolean;
}

export const deriveEffectiveFolderTreeSections = (
  persistedSections: readonly string[],
  isSearching: boolean,
  matches: FolderTreeSearchMatches,
): ReadonlySet<string> => {
  const effectiveSections = new Set(persistedSections);
  if (!isSearching) return effectiveSections;

  for (const section of ['pinned', 'current', 'albums'] as const) {
    if (matches[section]) effectiveSections.add(section);
  }

  return effectiveSections;
};

export const deriveEffectiveDisclosureState = <Section extends string>(
  persistedState: Readonly<Record<Section, boolean>>,
  isSearching: boolean,
  matchingSections: ReadonlySet<Section>,
): Record<Section, boolean> => {
  if (!isSearching || matchingSections.size === 0) return { ...persistedState };

  const effectiveState: Record<Section, boolean> = { ...persistedState };
  for (const section of matchingSections) effectiveState[section] = true;
  return effectiveState;
};
