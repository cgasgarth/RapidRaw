import { useCallback, useMemo, useState } from 'react';

import {
  ExportColorProfile,
  type ExportPreset,
  ExportRenderingIntent,
  FILE_FORMATS,
  FileFormats,
  type OutputSharpeningSettings,
  WatermarkAnchor,
} from '../components/ui/ExportImportProperties';

const FILE_FORMAT_IDS = new Set<string>(FILE_FORMATS.map((format) => format.id));
const WATERMARK_ANCHORS = new Set<string>(Object.values(WatermarkAnchor));
const DEFAULT_OUTPUT_SHARPENING: OutputSharpeningSettings = {
  amount: 35,
  radiusPx: 0.7,
  target: 'screen',
  threshold: 0.02,
};

const isFileFormat = (value: string): value is FileFormats => FILE_FORMAT_IDS.has(value);
const isWatermarkAnchor = (value: string): value is WatermarkAnchor => WATERMARK_ANCHORS.has(value);

export function useExportSettings() {
  const [blackPointCompensation, setBlackPointCompensation] = useState(false);
  const [colorProfile, setColorProfile] = useState<ExportColorProfile>(ExportColorProfile.Srgb);
  const [renderingIntent, setRenderingIntent] = useState<ExportRenderingIntent>(
    ExportRenderingIntent.RelativeColorimetric,
  );
  const [fileFormat, setFileFormat] = useState<FileFormats>(FileFormats.Jpeg);
  const [jpegQuality, setJpegQuality] = useState(90);
  const [enableResize, setEnableResize] = useState(false);
  const [resizeMode, setResizeMode] = useState('longEdge');
  const [resizeValue, setResizeValue] = useState(2048);
  const [dontEnlarge, setDontEnlarge] = useState(true);
  const [keepMetadata, setKeepMetadata] = useState(true);
  const [preserveTimestamps, setPreserveTimestamps] = useState(false);
  const [stripGps, setStripGps] = useState(true);
  const [exportMasks, setExportMasks] = useState(false);
  const [preserveFolders, setPreserveFolders] = useState(false);
  const [filenameTemplate, setFilenameTemplate] = useState('{original_filename}_edited');
  const [enableWatermark, setEnableWatermark] = useState(false);
  const [watermarkPath, setWatermarkPath] = useState<string | null>(null);
  const [watermarkAnchor, setWatermarkAnchor] = useState<WatermarkAnchor>(WatermarkAnchor.BottomRight);
  const [watermarkScale, setWatermarkScale] = useState(10);
  const [watermarkSpacing, setWatermarkSpacing] = useState(5);
  const [watermarkOpacity, setWatermarkOpacity] = useState(75);
  const [outputSharpening, setOutputSharpening] = useState<OutputSharpeningSettings | null>(null);

  const handleApplyPreset = useCallback((preset: ExportPreset) => {
    setBlackPointCompensation(preset.blackPointCompensation ?? false);
    setColorProfile(preset.colorProfile ?? ExportColorProfile.Srgb);
    setRenderingIntent(preset.renderingIntent ?? ExportRenderingIntent.RelativeColorimetric);
    setFileFormat(isFileFormat(preset.fileFormat) ? preset.fileFormat : FileFormats.Jpeg);
    setJpegQuality(preset.jpegQuality);
    setEnableResize(preset.enableResize);
    setResizeMode(preset.resizeMode);
    setResizeValue(preset.resizeValue);
    setDontEnlarge(preset.dontEnlarge);
    setKeepMetadata(preset.keepMetadata);
    setPreserveTimestamps(preset.preserveTimestamps);
    setStripGps(preset.stripGps);
    setExportMasks(preset.exportMasks ?? false);
    setPreserveFolders(preset.preserveFolders ?? false);
    setFilenameTemplate(preset.filenameTemplate);
    setEnableWatermark(preset.enableWatermark);
    setWatermarkPath(preset.watermarkPath);
    setWatermarkAnchor(
      isWatermarkAnchor(preset.watermarkAnchor) ? preset.watermarkAnchor : WatermarkAnchor.BottomRight,
    );
    setWatermarkScale(preset.watermarkScale);
    setWatermarkSpacing(preset.watermarkSpacing);
    setWatermarkOpacity(preset.watermarkOpacity);
    setOutputSharpening(preset.outputSharpening ?? null);
  }, []);

  const currentSettingsObject = useMemo(
    () => ({
      blackPointCompensation,
      colorProfile,
      renderingIntent,
      fileFormat,
      jpegQuality,
      enableResize,
      resizeMode,
      resizeValue,
      dontEnlarge,
      keepMetadata,
      preserveTimestamps,
      stripGps,
      exportMasks,
      preserveFolders,
      filenameTemplate,
      enableWatermark,
      watermarkPath,
      watermarkAnchor,
      watermarkScale,
      watermarkSpacing,
      watermarkOpacity,
      outputSharpening,
    }),
    [
      blackPointCompensation,
      colorProfile,
      renderingIntent,
      fileFormat,
      jpegQuality,
      enableResize,
      resizeMode,
      resizeValue,
      dontEnlarge,
      keepMetadata,
      preserveTimestamps,
      stripGps,
      exportMasks,
      preserveFolders,
      filenameTemplate,
      enableWatermark,
      watermarkPath,
      watermarkAnchor,
      watermarkScale,
      watermarkSpacing,
      watermarkOpacity,
      outputSharpening,
    ],
  );

  const enableDefaultOutputSharpening = useCallback(() => {
    setOutputSharpening(DEFAULT_OUTPUT_SHARPENING);
  }, []);

  const updateOutputSharpening = useCallback((updates: Partial<OutputSharpeningSettings>) => {
    setOutputSharpening((current) => ({ ...DEFAULT_OUTPUT_SHARPENING, ...current, ...updates }));
  }, []);

  return {
    blackPointCompensation,
    setBlackPointCompensation,
    colorProfile,
    setColorProfile,
    renderingIntent,
    setRenderingIntent,
    fileFormat,
    setFileFormat,
    jpegQuality,
    setJpegQuality,
    enableResize,
    setEnableResize,
    resizeMode,
    setResizeMode,
    resizeValue,
    setResizeValue,
    dontEnlarge,
    setDontEnlarge,
    keepMetadata,
    setKeepMetadata,
    preserveTimestamps,
    setPreserveTimestamps,
    stripGps,
    setStripGps,
    exportMasks,
    setExportMasks,
    preserveFolders,
    setPreserveFolders,
    filenameTemplate,
    setFilenameTemplate,
    enableWatermark,
    setEnableWatermark,
    watermarkPath,
    setWatermarkPath,
    watermarkAnchor,
    setWatermarkAnchor,
    watermarkScale,
    setWatermarkScale,
    watermarkSpacing,
    setWatermarkSpacing,
    watermarkOpacity,
    setWatermarkOpacity,
    outputSharpening,
    setOutputSharpening,
    enableDefaultOutputSharpening,
    updateOutputSharpening,
    handleApplyPreset,
    currentSettingsObject,
  };
}
