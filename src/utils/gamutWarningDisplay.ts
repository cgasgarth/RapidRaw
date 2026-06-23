import type { GamutWarningOverlayPayload } from '../schemas/tauriEventSchemas';

export const formatGamutWarningCoverage = (overlay: GamutWarningOverlayPayload | null): string => {
  if (!overlay || overlay.warning_pixel_count === 0) return 'Clear';

  const percent = overlay.coverage_ratio * 100;
  if (percent < 0.1) return '<0.1%';
  if (percent >= 99.95) return '100%';
  return `${percent.toFixed(1)}%`;
};
