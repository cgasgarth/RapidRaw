import {
  type DetailOutputComparisonVisualProof,
  detailOutputComparisonVisualProofSchema,
} from '../../schemas/detailValidationSchemas';

export const DETAIL_OUTPUT_COMPARISON_ARTIFACT_ROOT = 'artifacts/validation/detail-output-comparison';

export const DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF: DetailOutputComparisonVisualProof =
  detailOutputComparisonVisualProofSchema.parse({
    comparisonMode: 'original_current_recipe_export',
    cropClipped: false,
    cropZoomPercent: 100,
    deblurStrength: 0.7,
    denoiseLuma: 0.58,
    exportArtifactPath: `${DETAIL_OUTPUT_COMPARISON_ARTIFACT_ROOT}/high-iso-skin-shadow-v1-enabled-export.pgm`,
    fixtureId: 'detail.output.high-iso-denoise-detail-100.v1',
    recipeApplied: true,
    recipeId: 'detail.output.denoise-detail-100.v1',
    renderFallback: false,
    runtimeStatus: 'synthetic_detail_output_comparison_artifact_rendered',
    warningCodes: ['halo_risk_review', 'oversmoothing_review', 'crop_bounds_ok'],
  });
