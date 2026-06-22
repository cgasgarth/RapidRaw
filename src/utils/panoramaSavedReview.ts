import {
  panoramaSavedReviewSummarySchema,
  type PanoramaRenderedReview,
  type PanoramaSavedReviewSummary,
  type PanoramaUiSettings,
} from '../schemas/panoramaUiSchemas';

export const buildPanoramaSavedReviewSummary = ({
  outputPath,
  renderedReview,
  settings,
}: {
  outputPath: string;
  renderedReview: PanoramaRenderedReview;
  settings: PanoramaUiSettings;
}): PanoramaSavedReviewSummary =>
  panoramaSavedReviewSummarySchema.parse({
    boundaryMode: settings.boundaryMode,
    capabilityLevel: 'runtime_apply_capable',
    crop: renderedReview.boundary.crop,
    exposureNormalizationSummary: renderedReview.exposureNormalizationSummary,
    outputDimensions: renderedReview.outputDimensions,
    outputPath,
    projection: settings.projection,
    seamReview: renderedReview.seamReview,
    sourceCount: renderedReview.sources.stitchedSourceIndices.length,
    sourceContribution: renderedReview.sourceContribution,
    warningCodes: renderedReview.warningCodes,
  });
