import type { ImportResumeValidation } from '../../schemas/fileOperationSchemas';
import type { RawDevelopmentReport } from '../../schemas/imageLoaderSchemas';
import {
  EXPORT_FILE_FORMATS,
  ExportFileFormatId,
  type ExportFileFormatId as ExportFileFormatIdType,
} from '../../utils/export/exportFormatIds';
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
  blackPointCompensation?: boolean | undefined;
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
  renderingIntent?: ExportRenderingIntent | undefined;
}

export enum ExportColorProfile {
  Srgb = 'srgb',
  DisplayP3 = 'displayP3',
  AdobeRgb1998 = 'adobeRgb1998',
  ProPhotoRgb = 'proPhotoRgb',
  SourceEmbedded = 'sourceEmbedded',
}

export enum ExportRenderingIntent {
  AbsoluteColorimetric = 'absoluteColorimetric',
  Perceptual = 'perceptual',
  RelativeColorimetric = 'relativeColorimetric',
  Saturation = 'saturation',
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
  terminalStatus: 'cancelled' | 'completed';
  total: number;
}

export interface ExportReceiptOutput {
  auxiliaryOutputPaths?: Array<string> | undefined;
  bitDepth?: number | null | undefined;
  blackPointCompensation?: string | null | undefined;
  byteSize: number;
  cmm?: string | null | undefined;
  colorManagedTransform?: string | null | undefined;
  colorProfile?: string | null | undefined;
  effectiveColorProfile?: string | null | undefined;
  format: string;
  iccEmbedded?: boolean | null | undefined;
  outputPath: string;
  policyStatus?: string | null | undefined;
  policyVersion?: string | null | undefined;
  rawDevelopmentReport?: RawDevelopmentReport | null | undefined;
  rawProvenanceSidecarPath?: string | null | undefined;
  renderingIntent?: string | null | undefined;
  requestedColorProfile?: string | null | undefined;
  requestedRenderingIntent?: string | null | undefined;
  resolvedDisabledReason?: string | null | undefined;
  effectiveRenderingIntent?: string | null | undefined;
  sourcePath: string;
  sourceIccProfileHash?: string | null | undefined;
  sourcePrecisionPath?: string | null | undefined;
  transformPolicyFingerprint?: string | null | undefined;
  transformApplied?: boolean | null | undefined;
}

export interface FileFormat {
  extensions: Array<string>;
  id: FileFormats;
  name: string;
}

export interface ImportState {
  errorMessage: string;
  jobId?: string;
  path?: string;
  progress?: Progress;
  stage?: string;
  bytesCopied?: number;
  totalBytes?: number;
  status: Status;
  resumeValidation?: ImportResumeValidation;
  resumeError?: string;
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
  blackPointCompensation?: boolean;
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
  renderingIntent?: ExportRenderingIntent;
}
