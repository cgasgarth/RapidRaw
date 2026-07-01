export const PANEL_SCOPES_HEIGHT = {
  default: 192,
  min: 160,
  max: 320,
} as const;

export const clampPanelScopesHeight = (height: number): number =>
  Math.max(PANEL_SCOPES_HEIGHT.min, Math.min(PANEL_SCOPES_HEIGHT.max, Math.round(height)));
