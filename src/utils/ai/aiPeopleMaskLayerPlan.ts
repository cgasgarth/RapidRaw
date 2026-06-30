import {
  type AiPeopleMaskAnalysis,
  type AiPeopleMaskFakeAlphaMask,
  type AiPeopleMaskLayerApplyPlan,
  aiPeopleMaskLayerApplyPlanSchema,
} from '../../schemas/masks/aiMaskingSchemas';

const titleCasePart = (part: string): string =>
  part
    .split('_')
    .map((token) => `${token.charAt(0).toUpperCase()}${token.slice(1)}`)
    .join(' ');

export function createAiPeopleMaskLayerApplyPlan(
  analysis: AiPeopleMaskAnalysis,
  masks: Array<AiPeopleMaskFakeAlphaMask>,
): AiPeopleMaskLayerApplyPlan {
  return aiPeopleMaskLayerApplyPlanSchema.parse({
    imageHash: analysis.imageHash,
    layers: masks.map((mask) => ({
      artifactId: mask.artifactId,
      layerId: `layer.${mask.artifactId}`,
      maskOperationId: `operation.${mask.artifactId}`,
      name: `People ${titleCasePart(mask.target.part)}${mask.target.personId === null ? '' : ` ${mask.target.personId}`}`,
      opacity: 100,
      target: mask.target,
      visible: true,
    })),
    providerTier: analysis.providerTier,
    schemaVersion: 1,
    status: 'dry_run',
    warnings: analysis.warnings,
  });
}
