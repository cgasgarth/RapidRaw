export const canvasOverlayTokens = {
  colors: {
    active: '#76b8d8',
    activeFill: 'rgba(118, 184, 216, 0.24)',
    additive: '#eaf0f5',
    background: 'rgba(12, 14, 17, 0.82)',
    disabled: 'rgba(161, 168, 176, 0.42)',
    eraser: '#ed6e74',
    foreground: '#67be8b',
    gamut: '#df78cf',
    neutral: 'rgba(245, 247, 250, 0.9)',
    neutralMuted: 'rgba(245, 247, 250, 0.58)',
    ready: '#67be8b',
    remove: '#dbab53',
    stale: '#dbab53',
    target: '#ed8d66',
  },
  label: {
    cornerRadius: 6,
    fill: 'rgba(12, 14, 17, 0.84)',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 12,
    fontStyle: '600',
    padding: 6,
    text: '#f4f7fa',
  },
  shadow: {
    blur: 7,
    color: 'rgba(0, 0, 0, 0.88)',
    opacity: 0.72,
  },
  stroke: {
    inactiveOpacity: 0.68,
    selectedWidth: 3,
    width: 2,
  },
} as const;

export type CanvasOverlayStatus = 'active' | 'disabled' | 'drag' | 'loading' | 'ready' | 'stale' | 'warning';

export const canvasOverlayStatusColor = (status: CanvasOverlayStatus): string => {
  switch (status) {
    case 'active':
    case 'drag':
      return canvasOverlayTokens.colors.active;
    case 'disabled':
      return canvasOverlayTokens.colors.disabled;
    case 'loading':
    case 'warning':
      return canvasOverlayTokens.colors.remove;
    case 'stale':
      return canvasOverlayTokens.colors.stale;
    case 'ready':
      return canvasOverlayTokens.colors.ready;
  }
};
