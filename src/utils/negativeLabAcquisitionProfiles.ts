import {
  type NegativeLabAcquisitionProfile,
  type NegativeLabAcquisitionProfileId,
  negativeLabAcquisitionProfilesSchema,
} from '../schemas/negative-lab/negativeLabAcquisitionProfileSchemas';

export const NEGATIVE_LAB_ACQUISITION_PROFILES = negativeLabAcquisitionProfilesSchema.parse([
  {
    channelBasis: 'camera_rgb',
    displayName: 'Camera RAW linear capture',
    id: 'camera_raw_linear_v1',
    inputTransform: 'linear_camera_raw',
    provenanceSummary: 'Camera RAW capture with scanner/lab auto corrections avoided; preferred for inversion.',
    warningCodes: ['scanner_profile_unmeasured'],
  },
  {
    channelBasis: 'camera_rgb',
    displayName: 'Linear DNG copy scan',
    id: 'dng_linear_camera_v1',
    inputTransform: 'linear_dng',
    provenanceSummary: 'DNG camera scan treated as linear camera RGB before density inversion.',
    warningCodes: ['scanner_profile_unmeasured'],
  },
  {
    channelBasis: 'scanner_rgb',
    displayName: '16-bit flatbed/film scanner TIFF',
    id: 'scanner_tiff_16bit_flat_v1',
    inputTransform: 'scanner_rgb_flat',
    provenanceSummary: 'Flat 16-bit scanner RGB input with automatic color, contrast, sharpening, and inversion off.',
    warningCodes: ['scanner_profile_unmeasured'],
  },
  {
    channelBasis: 'rendered_rgb',
    displayName: 'Rendered JPEG review source',
    id: 'scanner_rgb_jpeg_review_v1',
    inputTransform: 'rendered_rgb_review_only',
    provenanceSummary: 'Rendered RGB review input; useful for workflow checks but not final-quality inversion proof.',
    warningCodes: ['auto_corrections_unknown', 'lossy_review_only'],
  },
]);

export const DEFAULT_NEGATIVE_LAB_ACQUISITION_PROFILE_ID: NegativeLabAcquisitionProfileId = 'camera_raw_linear_v1';

export const getNegativeLabAcquisitionProfile = (
  id: NegativeLabAcquisitionProfileId,
): NegativeLabAcquisitionProfile => {
  const profile = NEGATIVE_LAB_ACQUISITION_PROFILES.find((candidate) => candidate.id === id);
  if (profile === undefined) {
    throw new Error(`Unknown Negative Lab acquisition profile: ${id}`);
  }
  return profile;
};
