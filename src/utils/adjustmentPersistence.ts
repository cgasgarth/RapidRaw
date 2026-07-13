export interface AdjustmentPersistenceSnapshot<T> {
  adjustments: T;
  path: string;
}

export type AdjustmentPersistenceDecision<T> =
  | { action: 'prime'; snapshot: AdjustmentPersistenceSnapshot<T> }
  | { action: 'persist'; snapshot: AdjustmentPersistenceSnapshot<T> }
  | { action: 'unchanged'; snapshot: AdjustmentPersistenceSnapshot<T> };

export const decideAdjustmentPersistence = <T>(
  previous: AdjustmentPersistenceSnapshot<T> | null,
  path: string,
  adjustments: T,
  areEqual: (left: T, right: T) => boolean,
): AdjustmentPersistenceDecision<T> => {
  const snapshot = { adjustments, path };
  if (previous?.path !== path) return { action: 'prime', snapshot };
  if (areEqual(previous.adjustments, adjustments)) return { action: 'unchanged', snapshot: previous };
  return { action: 'persist', snapshot };
};
