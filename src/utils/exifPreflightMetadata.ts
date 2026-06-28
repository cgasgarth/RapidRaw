export const readExifString = (exif: Record<string, string> | null | undefined, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = exif?.[key]?.trim();
    if (value) return value;
  }
  return undefined;
};

export const parseExifInteger = (
  exif: Record<string, string> | null | undefined,
  keys: string[],
): number | undefined => {
  const value = readExifString(exif, keys);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value.replace(/[^\d]/gu, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export const parseExposureEv = (exif: Record<string, string> | null | undefined): number | undefined => {
  const exposureBias = readExifString(exif, ['ExposureBiasValue']);
  if (exposureBias === undefined) return undefined;
  return parseExifNumber(exposureBias);
};

export const parseExifDistanceMm = (
  exif: Record<string, string> | null | undefined,
  keys: string[],
): number | undefined => {
  const value = readExifString(exif, keys);
  if (value === undefined) return undefined;
  const parsed = parseExifNumber(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return /\b(mm|millimeter|millimeters)\b/iu.test(value) ? parsed : parsed * 1000;
};

const parseExifNumber = (value: string): number | undefined => {
  const fraction = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/u.exec(value.trim());
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return denominator === 0 ? undefined : numerator / denominator;
  }
  const parsed = Number.parseFloat(value.replace(/,/gu, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
};
