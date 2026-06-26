import { stableAgentPreviewHash } from './agentPreviewEnvelope';

import type { Adjustments } from './adjustments';

export const buildAgentGeometryRecipeHashInput = (adjustments: Adjustments) => ({
  aspectRatio: adjustments.aspectRatio,
  crop: adjustments.crop,
  flipHorizontal: adjustments.flipHorizontal,
  flipVertical: adjustments.flipVertical,
  orientationSteps: adjustments.orientationSteps,
  rotation: adjustments.rotation,
  transformAspect: adjustments.transformAspect,
  transformDistortion: adjustments.transformDistortion,
  transformHorizontal: adjustments.transformHorizontal,
  transformRotate: adjustments.transformRotate,
  transformScale: adjustments.transformScale,
  transformVertical: adjustments.transformVertical,
  transformXOffset: adjustments.transformXOffset,
  transformYOffset: adjustments.transformYOffset,
});

export const hashAgentGeometryRecipeInput = (adjustments: Adjustments): string =>
  stableAgentPreviewHash(JSON.stringify(buildAgentGeometryRecipeHashInput(adjustments)));
