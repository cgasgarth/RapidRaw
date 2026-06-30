import type {
  ExportColorCapabilityCatalogV1,
  ExportColorCapabilityV1,
} from '../../../packages/rawengine-schema/src/exportColorCapabilities';
import { ExportColorProfile, ExportRenderingIntent, FileFormats } from '../../components/ui/ExportImportProperties';

const COLOR_MANAGED_OUTPUT_FORMATS: ReadonlySet<FileFormats> = new Set([FileFormats.Jpeg, FileFormats.Tiff]);

const WIDE_GAMUT_EXPORT_PROFILES: ReadonlySet<ExportColorProfile> = new Set([
  ExportColorProfile.AdobeRgb1998,
  ExportColorProfile.DisplayP3,
  ExportColorProfile.ProPhotoRgb,
]);

export const supportsColorManagedOutput = (fileFormat: FileFormats) => COLOR_MANAGED_OUTPUT_FORMATS.has(fileFormat);

export const isSupportedColorProfileForFormat = (fileFormat: FileFormats, colorProfile: ExportColorProfile) =>
  colorProfile === ExportColorProfile.Srgb ||
  (WIDE_GAMUT_EXPORT_PROFILES.has(colorProfile) && supportsColorManagedOutput(fileFormat));

export const hasColorManagedTransform = (fileFormat: FileFormats, colorProfile: ExportColorProfile) =>
  supportsColorManagedOutput(fileFormat) && WIDE_GAMUT_EXPORT_PROFILES.has(colorProfile);

export const getExportColorCapability = (
  catalog: ExportColorCapabilityCatalogV1,
  colorProfile: ExportColorCapabilityV1['colorProfile'],
) => catalog.capabilities.find((capability) => capability.colorProfile === colorProfile) ?? null;

export const getSupportedRenderingIntents = (
  catalog: ExportColorCapabilityCatalogV1,
  fileFormat: FileFormats,
  colorProfile: ExportColorProfile,
): ExportRenderingIntent[] => {
  if (!hasColorManagedTransform(fileFormat, colorProfile)) return [];
  const capability = getExportColorCapability(catalog, colorProfile);
  return (
    capability?.renderingIntents.filter((intent): intent is ExportRenderingIntent =>
      Object.values(ExportRenderingIntent).includes(intent as ExportRenderingIntent),
    ) ?? []
  );
};

export const getBlackPointCompensationStatus = (
  catalog: ExportColorCapabilityCatalogV1,
  fileFormat: FileFormats,
  colorProfile: ExportColorProfile,
): ExportColorCapabilityV1['blackPointCompensation'] =>
  hasColorManagedTransform(fileFormat, colorProfile)
    ? (getExportColorCapability(catalog, colorProfile)?.blackPointCompensation ?? 'unsupported')
    : 'unsupported';

export const isBlackPointCompensationAvailable = ({
  catalog,
  colorProfile,
  fileFormat,
  renderingIntent,
}: {
  catalog: ExportColorCapabilityCatalogV1;
  colorProfile: ExportColorProfile;
  fileFormat: FileFormats;
  renderingIntent: ExportRenderingIntent;
}) =>
  (fileFormat === FileFormats.Jpeg || fileFormat === FileFormats.Tiff) &&
  renderingIntent === ExportRenderingIntent.RelativeColorimetric &&
  getBlackPointCompensationStatus(catalog, fileFormat, colorProfile) === 'supported';
