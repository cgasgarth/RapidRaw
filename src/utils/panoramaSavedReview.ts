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
    outputDimensions: renderedReview.outputDimensions,
    outputPath,
    projection: settings.projection,
    sourceCount: renderedReview.sources.stitchedSourceIndices.length,
    warningCodes: renderedReview.warningCodes,
  });
