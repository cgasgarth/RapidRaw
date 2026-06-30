import type { MaskComposeMode } from '../schemas/masks/maskRenderSchemas';

export interface MaskComposeContribution {
  mode: MaskComposeMode;
  opacity: number;
  weight: number;
}

const clamp01 = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

export function applyMaskComposeOperation(
  baseWeight: number,
  contributionWeight: number,
  mode: MaskComposeMode,
): number {
  const base = clamp01(baseWeight);
  const contribution = clamp01(contributionWeight);

  if (mode === 'add') {
    return 1 - (1 - base) * (1 - contribution);
  }

  if (mode === 'subtract') {
    return base * (1 - contribution);
  }

  return base * contribution;
}

export function composeMaskWeights(contributions: Array<MaskComposeContribution>): number {
  return contributions.reduce((currentWeight, contribution) => {
    const weightedContribution = clamp01(contribution.weight) * clamp01(contribution.opacity);
    return applyMaskComposeOperation(currentWeight, weightedContribution, contribution.mode);
  }, 0);
}
