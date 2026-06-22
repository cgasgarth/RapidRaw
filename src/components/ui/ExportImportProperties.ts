import {
  EXPORT_FILE_FORMATS,
  ExportFileFormatId,
  type ExportFileFormatId as ExportFileFormatIdType,
} from '../../utils/exportFormatIds';

import type { Progress } from './AppProperties';

export const EXPORT_TIMEOUT = 4000;
export const IMPORT_TIMEOUT = 5000;

export const FileFormats = ExportFileFormatId;
export type FileFormats = ExportFileFormatIdType;

export const FILE_FORMATS: Array<FileFormat> = EXPORT_FILE_FORMATS.map((format) => ({
  extensions: [...format.extensions],
  id: format.id,
  name: format.name,
}));

export const FILENAME_VARIABLES: Array<string> = [
  '{original_filename}',
  '{sequence}',
  '{YYYY}',
  '{MM}',
  '{DD}',
  '{hh}',
  '{mm}',
];

export interface ExportSettings {
  colorProfile?: ExportColorProfile | undefined;
  filenameTemplate: string | null;
  jpegQuality: number;
  keepMetadata: boolean;
  preserveTimestamps: boolean;
  resize: {
    mode: string;
    value: number;
    dontEnlarge: boolean;
  } | null;
  stripGps: boolean;
  watermark: WatermarkSettings | null;
  exportMasks?: boolean | undefined;
  outputSharpening?: OutputSharpeningSettings | null | undefined;
  preserveFolders?: boolean | undefined;
}

export enum ExportColorProfile {
  Srgb = 'srgb',
  DisplayP3 = 'displayP3',
  AdobeRgb1998 = 'adobeRgb1998',
  ProPhotoRgb = 'proPhotoRgb',
  SourceEmbedded = 'sourceEmbedded',
}

export interface OutputSharpeningSettings {
  amount: number;
  radiusPx: number;
  target: 'custom' | 'print' | 'screen';
  threshold: number;
}

export enum WatermarkAnchor {
  TopLeft = 'topLeft',
  TopCenter = 'topCenter',
  TopRight = 'topRight',
  CenterLeft = 'centerLeft',
  Center = 'center',
  CenterRight = 'centerRight',
  BottomLeft = 'bottomLeft',
  BottomCenter = 'bottomCenter',
  BottomRight = 'bottomRight',
}

export interface WatermarkSettings {
  path: string;
  anchor: WatermarkAnchor;
  scale: number;
  spacing: number;
  opacity: number;
}

export interface ExportState {
  errorMessage: string;
  lastReceipt?: ExportReceipt | undefined;
  progress: Progress;
  status: Status;
}

export interface ExportReceipt {
  completedAt: string;
  outputs: Array<ExportReceiptOutput>;
  total: number;
}

export interface ExportReceiptOutput {
  byteSize: number;
  format: string;
  outputPath: string;
  sourcePath: string;
}

export interface FileFormat {
  extensions: Array<string>;
  id: FileFormats;
  name: string;
}

export interface ImportState {
  errorMessage: string;
  path?: string;
  progress?: Progress;
  status: Status;
}

export enum Status {
  Cancelled = 'cancelled',
  Exporting = 'exporting',
  Error = 'error',
  Idle = 'idle',
  Importing = 'importing',
  Success = 'success',
}

export interface ExportPreset {
  colorProfile?: ExportColorProfile;
  id: string;
  name: string;
  fileFormat: string;
  jpegQuality: number;
  enableResize: boolean;
  resizeMode: string;
  resizeValue: number;
  dontEnlarge: boolean;
  keepMetadata: boolean;
  preserveTimestamps: boolean;
  stripGps: boolean;
  exportMasks?: boolean;
  preserveFolders?: boolean;
  filenameTemplate: string;
  enableWatermark: boolean;
  watermarkPath: string | null;
  watermarkAnchor: string;
  watermarkScale: number;
  watermarkSpacing: number;
  watermarkOpacity: number;
  lastExportPath?: string;
  outputSharpening?: OutputSharpeningSettings | null;
}
