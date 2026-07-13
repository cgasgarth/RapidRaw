export const ExportFileFormatId = {
  Avif: 'avif',
  Cube: 'cube',
  Jpeg: 'jpeg',
  Jxl: 'jxl',
  Png: 'png',
  Tiff: 'tiff',
  Webp: 'webp',
} as const;

export type ExportFileFormatId = (typeof ExportFileFormatId)[keyof typeof ExportFileFormatId];

export const EXPORT_RECIPE_FILE_FORMAT_IDS = [
  ExportFileFormatId.Jpeg,
  ExportFileFormatId.Png,
  ExportFileFormatId.Tiff,
  ExportFileFormatId.Webp,
] as const;

export const EXPORT_QUEUE_FILE_FORMAT_IDS = [
  ExportFileFormatId.Jpeg,
  ExportFileFormatId.Png,
  ExportFileFormatId.Tiff,
  ExportFileFormatId.Webp,
  ExportFileFormatId.Jxl,
  ExportFileFormatId.Avif,
  ExportFileFormatId.Cube,
] as const;

export const OUTPUT_SHARPENING_FILE_FORMAT_IDS = [
  ExportFileFormatId.Jpeg,
  ExportFileFormatId.Png,
  ExportFileFormatId.Tiff,
  ExportFileFormatId.Webp,
  ExportFileFormatId.Jxl,
] as const;

export const EXPORT_FILE_FORMATS = [
  { extensions: ['jpg', 'jpeg'], id: ExportFileFormatId.Jpeg, name: 'JPEG' },
  { extensions: ['png'], id: ExportFileFormatId.Png, name: 'PNG' },
  { extensions: ['tiff'], id: ExportFileFormatId.Tiff, name: 'TIFF' },
  { extensions: ['webp'], id: ExportFileFormatId.Webp, name: 'WebP' },
  { extensions: ['jxl'], id: ExportFileFormatId.Jxl, name: 'JPEG XL' },
  { extensions: ['avif'], id: ExportFileFormatId.Avif, name: 'AVIF' },
  { extensions: ['cube'], id: ExportFileFormatId.Cube, name: 'CUBE LUT' },
] as const;

export const isExportFormatAvailable = (format: ExportFileFormatId, advancedCodecs: boolean): boolean =>
  advancedCodecs || (format !== ExportFileFormatId.Jxl && format !== ExportFileFormatId.Webp);
