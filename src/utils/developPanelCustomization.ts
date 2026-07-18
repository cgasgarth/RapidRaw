/**
 * The panel list is presentation-only. These ids must never be used as render
 * authority or persisted with an image/edit document.
 */
export const DEVELOP_PANEL_IDS = [
  'curves',
  'colorMixer',
  'colorGrading',
  'details',
  'lensCorrection',
  'transform',
  'effects',
  'calibration',
] as const;

export type DevelopPanelId = (typeof DEVELOP_PANEL_IDS)[number];

/** Basic, the histogram, and the Develop tool strip are fixed surfaces. */
export const DEVELOP_PANEL_FIXED_IDS = ['basic', 'histogram', 'toolStrip'] as const;
export type DevelopPanelFixedId = (typeof DEVELOP_PANEL_FIXED_IDS)[number];

/** RapidRaw capabilities live outside this user-customizable stack. */
export const DEVELOP_PANEL_UTILITY_IDS = ['utilities', 'advanced'] as const;
export type DevelopPanelUtilityId = (typeof DEVELOP_PANEL_UTILITY_IDS)[number];

export const DEFAULT_DEVELOP_PANEL_ORDER: readonly DevelopPanelId[] = [...DEVELOP_PANEL_IDS];

export interface DevelopPanelCustomization {
  hidden: readonly DevelopPanelId[];
  order: readonly DevelopPanelId[];
}

export const DEFAULT_DEVELOP_PANEL_CUSTOMIZATION: DevelopPanelCustomization = {
  hidden: [],
  order: DEFAULT_DEVELOP_PANEL_ORDER,
};

const isDevelopPanelId = (value: unknown): value is DevelopPanelId =>
  typeof value === 'string' && (DEVELOP_PANEL_IDS as readonly string[]).includes(value);

/**
 * Rebuilds an order from the current canonical list. Unknown ids and
 * duplicates are ignored; newly shipped panels are appended in default order.
 */
export const normalizeDevelopPanelOrder = (value: readonly unknown[] | undefined): DevelopPanelId[] => {
  const seen = new Set<DevelopPanelId>();
  const order: DevelopPanelId[] = [];
  for (const candidate of value ?? []) {
    if (!isDevelopPanelId(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    order.push(candidate);
  }
  for (const candidate of DEFAULT_DEVELOP_PANEL_ORDER) {
    if (!seen.has(candidate)) order.push(candidate);
  }
  return order;
};

export const normalizeDevelopPanelHidden = (value: readonly unknown[] | undefined): DevelopPanelId[] => {
  const seen = new Set<DevelopPanelId>();
  for (const candidate of value ?? []) {
    if (isDevelopPanelId(candidate)) seen.add(candidate);
  }
  return DEVELOP_PANEL_IDS.filter((candidate) => seen.has(candidate));
};

export const normalizeDevelopPanelCustomization = (
  value: Partial<DevelopPanelCustomization> | null | undefined,
): DevelopPanelCustomization => ({
  hidden: normalizeDevelopPanelHidden(value?.hidden),
  order: normalizeDevelopPanelOrder(value?.order),
});

export const isValidDevelopPanelOrder = (value: readonly unknown[]): value is readonly DevelopPanelId[] =>
  value.length === DEVELOP_PANEL_IDS.length &&
  value.every(isDevelopPanelId) &&
  new Set(value).size === DEVELOP_PANEL_IDS.length;

export const isValidDevelopPanelHidden = (value: readonly unknown[]): value is readonly DevelopPanelId[] =>
  value.every(isDevelopPanelId) && new Set(value).size === value.length;
