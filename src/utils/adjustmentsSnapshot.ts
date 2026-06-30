import type { Adjustments } from './adjustments';

export const areAdjustmentsEqual = (left: Adjustments, right: Adjustments): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
