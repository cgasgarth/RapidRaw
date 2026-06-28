import type { ExifData } from '../components/ui/AppProperties';

export type RawQualityBadgeSeverity = 'info' | 'warning';

export interface RawQualityBadge {
  code: 'camera_profile_status' | 'processing_mode' | 'raw_warning';
  detail: string;
  label: string;
  severity: RawQualityBadgeSeverity;
}

const normalize = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const formatToken = (value: string): string =>
  value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`))
    .join(' ');

export const buildRawQualityBadges = (exif: ExifData | null | undefined): RawQualityBadge[] => {
  const mode = normalize(exif?.['RawEngineRawProcessingMode']);
  const provenance = normalize(exif?.['RawEngineRawProcessingProvenance']);
  const status = normalize(exif?.['RawEngineCameraProfileStatus']);
  const fallbackReason = normalize(exif?.['RawEngineCameraProfileFallbackReason']);
  const warnings = normalize(exif?.['RawEngineCameraProfileWarnings']);
  const badges: RawQualityBadge[] = [];

  if (status === 'fallback' || status === 'unavailable') {
    badges.push({
      code: 'camera_profile_status',
      detail: fallbackReason ?? formatToken(status),
      label: status === 'fallback' ? 'Fallback' : 'Profile',
      severity: 'warning',
    });
  }

  if (warnings !== null) {
    badges.push({
      code: 'raw_warning',
      detail: warnings
        .split(',')
        .map((warning) => formatToken(warning))
        .join(', '),
      label: 'Warn',
      severity: 'warning',
    });
  }

  if (mode !== null && mode !== 'balanced') {
    badges.push({
      code: 'processing_mode',
      detail: provenance === null ? formatToken(mode) : `${formatToken(mode)} - ${provenance}`,
      label: formatToken(mode),
      severity: 'info',
    });
  }

  return badges.slice(0, 2);
};

export const formatRawQualityBadgeTooltip = (badges: readonly RawQualityBadge[]): string =>
  badges.map((badge) => `${badge.label}: ${badge.detail}`).join('\n');
