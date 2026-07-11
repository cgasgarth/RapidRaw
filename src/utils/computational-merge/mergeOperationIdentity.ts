export type MergeOperationKind = 'hdr' | 'panorama';

export const buildMergeSourceIdentity = (sourcePaths: readonly string[]): string => JSON.stringify(sourcePaths);

export const buildMergeOperationId = (
  kind: MergeOperationKind,
  sourcePaths: readonly string[],
  openEpoch: number,
): string => `${kind}:${openEpoch}:${buildMergeSourceIdentity(sourcePaths)}`;

export const isMergeOperationActive = (state: {
  activeOperationId: string | null;
  isOpen: boolean;
  isProcessing: boolean;
}): boolean => state.activeOperationId !== null && state.isOpen && state.isProcessing;

export const orderedMergeSourcesMatch = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((path, index) => path === right[index]);
