import type { DisplayPreviewLutStatus } from '../schemas/displayProfileSchemas';
import type {
  XmpMetadataConflictChoice,
  XmpMetadataConflictDecision,
  XmpMetadataConflictReport,
} from '../schemas/xmpMetadataConflictSchemas';

export type MetadataValue = string | number | null | undefined;
export type MetadataExifData = Record<string, MetadataValue>;

export type MetadataNumberParseStatus = 'invalid' | 'missing' | 'valid' | 'zero';

export interface MetadataNumberParseResult {
  source: MetadataValue;
  status: MetadataNumberParseStatus;
  value: number | null;
}

export const METADATA_CAMERA_GRID_KEYS = [
  'ExposureTime',
  'FNumber',
  'PhotographicSensitivity',
  'FocalLengthIn35mmFilm',
] as const;

export const METADATA_EDITABLE_FIELDS = [
  { key: 'ImageDescription', label: 'title' },
  { key: 'Artist', label: 'author' },
  { key: 'Copyright', label: 'copyright' },
  { key: 'UserComment', label: 'comments' },
] as const;

export interface MetadataReadinessSummary {
  cameraFieldCount: number;
  editableFieldCount: number;
  gpsReady: boolean;
  selectionCount: number;
}

export const hasMetadataValue = (value: MetadataValue) => value !== undefined && value !== null && value !== '';

const formatFiniteMetadataNumber = (value: number, fractionDigits = 1): string => {
  const rounded = Number(value.toFixed(fractionDigits));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

export const parseExifMetadataNumber = (value: MetadataValue): MetadataNumberParseResult => {
  if (!hasMetadataValue(value)) return { source: value, status: 'missing', value: null };

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { source: value, status: 'invalid', value: null };
    return { source: value, status: value === 0 ? 'zero' : 'valid', value };
  }

  const raw = String(value).trim();
  if (raw.length === 0) return { source: value, status: 'missing', value: null };

  const normalized = raw
    .replace(/^f\s*\/\s*/iu, '')
    .replace(/[",']/gu, '')
    .replace(/\s*(?:mm|millimeters?|seconds?|secs?|sec|s|ev)\s*$/iu, '')
    .trim();

  const decimalSource = normalized.replace(/,/gu, '');
  const rationalMatch = /^([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*\/\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))$/u.exec(decimalSource);
  const parsed = rationalMatch
    ? Number(rationalMatch[1]) / Number(rationalMatch[2])
    : /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(decimalSource)
      ? Number.parseFloat(decimalSource)
      : Number.NaN;

  if (!Number.isFinite(parsed)) return { source: value, status: 'invalid', value: null };
  return { source: value, status: parsed === 0 ? 'zero' : 'valid', value: parsed };
};

export const formatExifAperture = (value: MetadataValue): string | undefined => {
  const parsed = parseExifMetadataNumber(value);
  if (parsed.status !== 'valid' || parsed.value === null || parsed.value <= 0) return undefined;
  return `f/${formatFiniteMetadataNumber(parsed.value, 2)}`;
};

export const formatExifFocalLength = (value: MetadataValue): string | undefined => {
  const parsed = parseExifMetadataNumber(value);
  if (parsed.status !== 'valid' || parsed.value === null || parsed.value <= 0) return undefined;
  return `${formatFiniteMetadataNumber(parsed.value)} mm`;
};

export const readExifMetadataValue = (
  exif: MetadataExifData | null | undefined,
  keys: readonly string[],
): MetadataValue => {
  for (const key of keys) {
    const value = exif?.[key];
    if (hasMetadataValue(value)) return value;
  }
  return undefined;
};

const readFormattedExifMetadataValue = (
  exif: MetadataExifData | null | undefined,
  keys: readonly string[],
  format: (value: MetadataValue) => string | undefined,
): string | undefined => {
  for (const key of keys) {
    const value = exif?.[key];
    if (!hasMetadataValue(value)) continue;

    const formatted = format(value);
    if (formatted !== undefined) return formatted;
  }
  return undefined;
};

export const formatExifApertureFromMetadata = (exif: MetadataExifData | null | undefined): string | undefined =>
  readFormattedExifMetadataValue(exif, ['FNumber', 'ApertureValue'], formatExifAperture);

export const formatExifFocalLengthFromMetadata = (exif: MetadataExifData | null | undefined): string | undefined =>
  readFormattedExifMetadataValue(exif, ['FocalLength', 'FocalLengthIn35mmFilm'], formatExifFocalLength);

export const buildMetadataReadinessSummary = ({
  exif,
  gpsCoordinates,
  selectionCount,
}: {
  exif: MetadataExifData;
  gpsCoordinates: { lat: number; lon: number } | null;
  selectionCount: number;
}): MetadataReadinessSummary => ({
  cameraFieldCount: [
    hasMetadataValue(exif['ExposureTime']),
    formatExifApertureFromMetadata(exif) !== undefined,
    hasMetadataValue(exif['PhotographicSensitivity']),
    formatExifFocalLengthFromMetadata(exif) !== undefined,
  ].filter(Boolean).length,
  editableFieldCount: METADATA_EDITABLE_FIELDS.length,
  gpsReady: gpsCoordinates !== null,
  selectionCount,
});

export const getDisplayPreviewLutLocaleStatus = (
  lut: DisplayPreviewLutStatus,
): 'active' | 'fallback' | 'unsupported' => {
  if (lut.status === 'active_display_transform') return 'active';
  if (lut.status === 'srgb_fallback_transform') return 'fallback';
  return 'unsupported';
};

export const getDefaultXmpConflictChoice = (field: XmpMetadataConflictDecision['field']): XmpMetadataConflictChoice =>
  field === 'keywords' ? 'merge' : 'external';

export const buildDefaultXmpConflictDecisions = (
  report: XmpMetadataConflictReport,
): Partial<Record<XmpMetadataConflictDecision['field'], XmpMetadataConflictChoice>> =>
  Object.fromEntries(report.fields.map((field) => [field.field, getDefaultXmpConflictChoice(field.field)]));
