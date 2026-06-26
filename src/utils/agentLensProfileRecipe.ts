import type { Adjustments } from './adjustments';

export const buildAgentLensProfileRecipeHashInput = (adjustments: Adjustments) => ({
  lensCorrectionMode: adjustments.lensCorrectionMode,
  lensDistortionAmount: adjustments.lensDistortionAmount,
  lensDistortionEnabled: adjustments.lensDistortionEnabled,
  lensDistortionParams: adjustments.lensDistortionParams,
  lensMaker: adjustments.lensMaker,
  lensModel: adjustments.lensModel,
  lensTcaAmount: adjustments.lensTcaAmount,
  lensTcaEnabled: adjustments.lensTcaEnabled,
  lensVignetteAmount: adjustments.lensVignetteAmount,
  lensVignetteEnabled: adjustments.lensVignetteEnabled,
});
