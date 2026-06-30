import type { DisplayPreviewLutStatus } from '../schemas/displayProfileSchemas';
import type {
  XmpMetadataConflictChoice,
  XmpMetadataConflictDecision,
  XmpMetadataConflictReport,
} from '../schemas/xmpMetadataConflictSchemas';

export type MetadataValue = string | number | null | undefined;
export type MetadataExifData = Record<string, MetadataValue>;

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

export const buildMetadataReadinessSummary = ({
  exif,
  gpsCoordinates,
  selectionCount,
}: {
  exif: MetadataExifData;
  gpsCoordinates: { lat: number; lon: number } | null;
  selectionCount: number;
}): MetadataReadinessSummary => ({
  cameraFieldCount: METADATA_CAMERA_GRID_KEYS.filter((key) => hasMetadataValue(exif[key])).length,
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
