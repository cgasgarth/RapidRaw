import type { Adjustments } from '../../adjustments';
import { stableAgentPreviewHash } from '../../agentPreviewEnvelope';

export const buildAgentCurveLevelsRecipeHashInput = (adjustments: Adjustments) => ({
  curveMode: adjustments.curveMode,
  curves: adjustments.curves,
  levels: adjustments.levels,
  parametricCurve: adjustments.parametricCurve,
  pointCurves: adjustments.pointCurves,
  toneCurve: adjustments.toneCurve,
});

export const hashAgentCurveLevelsRecipeInput = (adjustments: Adjustments): string =>
  stableAgentPreviewHash(JSON.stringify(buildAgentCurveLevelsRecipeHashInput(adjustments)));
