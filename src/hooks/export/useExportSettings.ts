import { useCallback, useMemo, useState } from 'react';
import {
  type ExportColorCapabilityCatalogV1,
  MOXCMS_EXPORT_COLOR_CAPABILITIES_V1,
} from '../../../packages/rawengine-schema/src/exportColorCapabilities';

import {
  ExportColorProfile,
  type ExportPreset,
  ExportRenderingIntent,
  FILE_FORMATS,
  FileFormats,
  type OutputSharpeningSettings,
  WatermarkAnchor,
} from '../../components/ui/ExportImportProperties';
import { normalizeExportColorSelection } from '../../utils/export/exportColorSelection';

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

interface ExportColorSettingsState {
  blackPointCompensation: boolean;
  catalog: ExportColorCapabilityCatalogV1;
  colorProfile: ExportColorProfile;
  fileFormat: FileFormats;
  renderingIntent: ExportRenderingIntent;
}

export function useExportSettings() {
  const [exportColorState, setExportColorState] = useState<ExportColorSettingsState>(() => ({
    blackPointCompensation: false,
    catalog: MOXCMS_EXPORT_COLOR_CAPABILITIES_V1,
    colorProfile: ExportColorProfile.Srgb,
    fileFormat: FileFormats.Jpeg,
    renderingIntent: ExportRenderingIntent.RelativeColorimetric,
  }));
  const {
    blackPointCompensation,
    catalog: exportColorCapabilityCatalog,
    colorProfile,
    fileFormat,
    renderingIntent,
  } = exportColorState;
  const updateColorSelection = useCallback(
    (patch: Partial<Omit<ExportColorSettingsState, 'catalog'>>, acceptedCatalog?: ExportColorCapabilityCatalogV1) => {
      setExportColorState((current) => {
        const catalog = acceptedCatalog ?? current.catalog;
        const requested = { ...current, ...patch };
        const { reasons: _reasons, ...selection } = normalizeExportColorSelection({
          catalog,
          fileFormat: requested.fileFormat,
          requestedBlackPointCompensation: requested.blackPointCompensation,
          requestedColorProfile: requested.colorProfile,
          requestedRenderingIntent: requested.renderingIntent,
        });
        return {
          catalog,
          fileFormat: requested.fileFormat,
          ...selection,
        };
      });
    },
    [],
  );
  const setBlackPointCompensation = useCallback(
    (value: boolean) => updateColorSelection({ blackPointCompensation: value }),
    [updateColorSelection],
  );
  const setColorProfile = useCallback(
    (value: ExportColorProfile) => updateColorSelection({ colorProfile: value }),
    [updateColorSelection],
  );
  const setRenderingIntent = useCallback(
    (value: ExportRenderingIntent) => updateColorSelection({ renderingIntent: value }),
    [updateColorSelection],
  );
  const setFileFormat = useCallback(
    (value: FileFormats) => updateColorSelection({ fileFormat: value }),
    [updateColorSelection],
  );
  const acceptExportColorCapabilityCatalog = useCallback(
    (catalog: ExportColorCapabilityCatalogV1) => updateColorSelection({}, catalog),
    [updateColorSelection],
  );
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

  const handleApplyPreset = useCallback(
    (preset: ExportPreset) => {
      const nextFileFormat = isFileFormat(preset.fileFormat) ? preset.fileFormat : FileFormats.Jpeg;
      updateColorSelection({
        blackPointCompensation: preset.blackPointCompensation ?? false,
        colorProfile: preset.colorProfile ?? ExportColorProfile.Srgb,
        fileFormat: nextFileFormat,
        renderingIntent: preset.renderingIntent ?? ExportRenderingIntent.RelativeColorimetric,
      });
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
    },
    [updateColorSelection],
  );

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
    acceptExportColorCapabilityCatalog,
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
    exportColorCapabilityCatalog,
    updateColorSelection,
  };
}
