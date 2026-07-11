import type { ExportColorCapabilityCatalogV1 } from '../../../packages/rawengine-schema/src/exportColorCapabilities';
import {
  ExportColorProfile,
  ExportRenderingIntent,
  type FileFormats,
} from '../../components/ui/ExportImportProperties';
import {
  getExportColorCapability,
  isBlackPointCompensationAvailable,
  isSupportedColorProfileForFormat,
} from './exportColorCapabilityContracts';

export type ExportColorNormalizationReason = 'bpc' | 'intent' | 'profile';

export interface NormalizedExportColorSelection {
  blackPointCompensation: boolean;
  colorProfile: ExportColorProfile;
  reasons: ExportColorNormalizationReason[];
  renderingIntent: ExportRenderingIntent;
}

export interface NormalizeExportColorSelectionInput {
  catalog: ExportColorCapabilityCatalogV1;
  fileFormat: FileFormats;
  requestedBlackPointCompensation: boolean;
  requestedColorProfile: ExportColorProfile;
  requestedRenderingIntent: ExportRenderingIntent;
}

const isColorProfile = (value: string): value is ExportColorProfile =>
  Object.values(ExportColorProfile).includes(value as ExportColorProfile);

const isRenderingIntent = (value: string): value is ExportRenderingIntent =>
  Object.values(ExportRenderingIntent).includes(value as ExportRenderingIntent);

export const normalizeExportColorSelection = ({
  catalog,
  fileFormat,
  requestedBlackPointCompensation,
  requestedColorProfile,
  requestedRenderingIntent,
}: NormalizeExportColorSelectionInput): NormalizedExportColorSelection => {
  const supportedProfiles = catalog.capabilities
    .map((capability) => capability.colorProfile)
    .filter(isColorProfile)
    .filter((profile) => isSupportedColorProfileForFormat(fileFormat, profile));
  const colorProfile = supportedProfiles.includes(requestedColorProfile)
    ? requestedColorProfile
    : supportedProfiles.includes(ExportColorProfile.Srgb)
      ? ExportColorProfile.Srgb
      : (supportedProfiles[0] ?? ExportColorProfile.Srgb);
  const capability = getExportColorCapability(catalog, colorProfile);
  const supportedIntents = capability?.renderingIntents.filter(isRenderingIntent) ?? [
    ExportRenderingIntent.RelativeColorimetric,
  ];
  const renderingIntent =
    colorProfile === ExportColorProfile.SourceEmbedded
      ? ExportRenderingIntent.RelativeColorimetric
      : supportedIntents.includes(requestedRenderingIntent)
        ? requestedRenderingIntent
        : supportedIntents.includes(ExportRenderingIntent.RelativeColorimetric)
          ? ExportRenderingIntent.RelativeColorimetric
          : (supportedIntents[0] ?? ExportRenderingIntent.RelativeColorimetric);
  const blackPointCompensation =
    colorProfile !== ExportColorProfile.SourceEmbedded &&
    requestedBlackPointCompensation &&
    isBlackPointCompensationAvailable({ catalog, colorProfile, fileFormat, renderingIntent });
  const reasons: ExportColorNormalizationReason[] = [];
  if (colorProfile !== requestedColorProfile) reasons.push('profile');
  if (renderingIntent !== requestedRenderingIntent) reasons.push('intent');
  if (blackPointCompensation !== requestedBlackPointCompensation) reasons.push('bpc');
  return { blackPointCompensation, colorProfile, reasons, renderingIntent };
};
