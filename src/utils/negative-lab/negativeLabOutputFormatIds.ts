export const NegativeLabOutputFormatId = {
  JpegProof: 'jpeg_proof',
  Tiff16: 'tiff16',
} as const;

export type NegativeLabOutputFormatId = (typeof NegativeLabOutputFormatId)[keyof typeof NegativeLabOutputFormatId];

export const NEGATIVE_LAB_OUTPUT_FORMAT_IDS = [
  NegativeLabOutputFormatId.JpegProof,
  NegativeLabOutputFormatId.Tiff16,
] as const;

export const NEGATIVE_LAB_OUTPUT_FORMAT_SELECTOR_IDS = [
  NegativeLabOutputFormatId.Tiff16,
  NegativeLabOutputFormatId.JpegProof,
] as const;
