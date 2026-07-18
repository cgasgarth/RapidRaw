/**
 * The fixed portion of the Develop inspector. Histogram/metadata and the
 * Develop tool strip are owned by the inspector header; this list is the
 * single source of truth for the editable panel order below them.
 */
export const DEVELOP_INSPECTOR_SECTION_ORDER = [
  'basic',
  'curves',
  'colorMixer',
  'colorGrading',
  'details',
  'lensCorrection',
  'transform',
  'effects',
  'calibration',
] as const;

export const DEVELOP_INSPECTOR_FIXED_SURFACES = ['histogram', 'toolStrip'] as const;

export const DEVELOP_INSPECTOR_STACK_ORDER = [
  ...DEVELOP_INSPECTOR_FIXED_SURFACES,
  ...DEVELOP_INSPECTOR_SECTION_ORDER,
] as const;

export type DevelopInspectorSectionId = (typeof DEVELOP_INSPECTOR_SECTION_ORDER)[number];

export const DEVELOP_INSPECTOR_UTILITY_ID = 'utilities' as const;

export const DEVELOP_INSPECTOR_SOLO_MODE_STORAGE_KEY = 'rapidraw.develop-inspector.solo-mode';

export const readDevelopInspectorSoloMode = (
  storage: Storage | undefined = typeof window === 'undefined' ? undefined : window.sessionStorage,
): boolean => {
  if (!storage) return false;
  try {
    return storage.getItem(DEVELOP_INSPECTOR_SOLO_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const saveDevelopInspectorSoloMode = (
  enabled: boolean,
  storage: Storage | undefined = typeof window === 'undefined' ? undefined : window.sessionStorage,
): void => {
  if (!storage) return;
  try {
    storage.setItem(DEVELOP_INSPECTOR_SOLO_MODE_STORAGE_KEY, String(enabled));
  } catch {
    // Session storage is optional (private browsing and native webviews may deny it).
  }
};

export const normalizeDevelopInspectorSectionIds = (sectionIds: readonly string[]): DevelopInspectorSectionId[] => {
  const known = new Set<string>(DEVELOP_INSPECTOR_SECTION_ORDER);
  return sectionIds.filter((sectionId, index, all): sectionId is DevelopInspectorSectionId => {
    return known.has(sectionId) && all.indexOf(sectionId) === index;
  });
};
