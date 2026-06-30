import type { Adjustments } from '../../adjustments';
import { stableAgentPreviewHash } from '../context/agentPreviewEnvelope';

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
  temperature: adjustments.temperature,
  tint: adjustments.tint,
  vibrance: adjustments.vibrance,
});

export const hashAgentColorRecipeInput = (adjustments: Adjustments): string =>
  stableAgentPreviewHash(JSON.stringify(buildAgentColorRecipeHashInput(adjustments)));
