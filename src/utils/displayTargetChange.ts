export const isNewDisplayResourceGeneration = (current: number, candidate: number): boolean =>
  Number.isSafeInteger(candidate) && candidate > current;
