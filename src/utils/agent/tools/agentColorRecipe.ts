import type { Adjustments } from '../../adjustments';

export const buildAgentColorRecipeHashInput = (adjustments: Adjustments) => ({
  blackWhiteMixer: adjustments.blackWhiteMixer,
  channelMixer: adjustments.channelMixer,
  colorBalanceRgb: adjustments.colorBalanceRgb,
  colorCalibration: adjustments.colorCalibration,
  colorGrading: adjustments.colorGrading,
  hsl: adjustments.hsl,
  saturation: adjustments.saturation,
  selectiveColorRangeControls: adjustments.selectiveColorRangeControls,
  skinToneUniformity: adjustments.skinToneUniformity,
  whiteBalanceTechnical: adjustments.whiteBalanceTechnical,
  vibrance: adjustments.vibrance,
});
