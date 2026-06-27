export type MaskParameterRecord = Record<string, unknown>;

export function toMaskParameterRecord(parameters: unknown): MaskParameterRecord {
  return parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? Object.fromEntries(Object.entries(parameters))
    : {};
}

export function getMaskParameterNumber(parameters: unknown, key: string, fallback = 0): number {
  const value = toMaskParameterRecord(parameters)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function mergeMaskParameters(parameters: unknown, patch: object): MaskParameterRecord {
  return { ...toMaskParameterRecord(parameters), ...patch };
}
