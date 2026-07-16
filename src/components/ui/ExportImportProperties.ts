import type { ExportRecipe } from '../../schemas/export/exportRecipeSchemas';
import type { ImportResumeValidation } from '../../schemas/fileOperationSchemas';
import type { RawDevelopmentReport } from '../../schemas/imageLoaderSchemas';
import {
  EXPORT_FILE_FORMATS,
  ExportFileFormatId,
  type ExportFileFormatId as ExportFileFormatIdType,
} from '../../utils/export/exportFormatIds';
import type { Progress } from './AppProperties';

const EXPORT_TIMEOUT = 4000;
const IMPORT_TIMEOUT = 5000;

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
  hdrWorkflow?: HdrExportWorkflowSettings | null | undefined;
}

export interface HdrExportWorkflowSettings {
  sdrRendition: {
    highlightCompression: number;
    contrast: number;
    shadowLift: number;
    saturation: number;
    targetWhiteNits: number;
  };
  target: 'sdr_companion_tiff16' | 'hdr_pq10' | 'hdr_hlg10';
}

export const ExportColorProfile = {
  AdobeRgb1998: 'adobeRgb1998',
  DisplayP3: 'displayP3',
  ProPhotoRgb: 'proPhotoRgb',
  SourceEmbedded: 'sourceEmbedded',
  Srgb: 'srgb',
} as const;
export type ExportColorProfile = (typeof ExportColorProfile)[keyof typeof ExportColorProfile];

export const ExportRenderingIntent = {
  AbsoluteColorimetric: 'absoluteColorimetric',
  Perceptual: 'perceptual',
  RelativeColorimetric: 'relativeColorimetric',
  Saturation: 'saturation',
} as const;
export type ExportRenderingIntent = (typeof ExportRenderingIntent)[keyof typeof ExportRenderingIntent];

export interface OutputSharpeningSettings {
  amount: number;
  radiusPx: number;
  target: 'custom' | 'print' | 'screen';
  threshold: number;
}

export const WatermarkAnchor = {
  BottomCenter: 'bottomCenter',
  BottomLeft: 'bottomLeft',
  BottomRight: 'bottomRight',
  Center: 'center',
  CenterLeft: 'centerLeft',
  CenterRight: 'centerRight',
  TopCenter: 'topCenter',
  TopLeft: 'topLeft',
  TopRight: 'topRight',
} as const;
export type WatermarkAnchor = (typeof WatermarkAnchor)[keyof typeof WatermarkAnchor];

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
  hdrOutput?: HdrExportReceipt | null | undefined;
  iccEmbedded?: boolean | null | undefined;
  outputPath: string;
  outputDigest?: ExportReceiptDigest | null | undefined;
  policyStatus?: string | null | undefined;
  policyVersion?: string | null | undefined;
  rawDevelopmentReport?: RawDevelopmentReport | null | undefined;
  rawProvenanceSidecarPath?: string | null | undefined;
  rawProvenanceError?: string | null | undefined;
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
  gamutMapping?: ExportGamutMappingReceipt | null | undefined;
}

export interface HdrExportReceipt {
  bitDepth: number;
  byteSize: number;
  colorPrimaries: string;
  colorPolicyFingerprint: string;
  fileFormat: string;
  implementationVersion: number;
  planFingerprint: string;
  rendition: string;
  sceneEditFingerprint: string;
  target: 'sdr_companion_tiff16' | 'hdr_pq10' | 'hdr_hlg10';
  transfer: string;
  viewFingerprint: string;
}

export interface ExportGamutMappingReceipt {
  implementationId: string;
  implementationVersion: number;
  target: string;
  mode: 'Output';
  renderingIntent: string;
  boundaryFingerprint: string;
  compressedPixelCount: number;
  hardClippedPixelCount: number;
  inputOutOfGamutPixelCount: number;
  maximumBoundaryExcess: number;
  pixelCount: number;
  planFingerprint: string;
}

export interface ExportReceiptDigest {
  algorithm: 'sha256';
  byteLen: number;
  provenance: 'finalByteAtomicWriter';
  value: string;
}

export interface FileFormat {
  extensions: Array<string>;
  id: FileFormats;
  name: string;
}

export interface ImportState {
  errorMessage: string;
  jobId?: string;
  generation?: number;
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

export type ExportPreset = ExportRecipe;
