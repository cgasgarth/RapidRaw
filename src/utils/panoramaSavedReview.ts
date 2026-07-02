import {
  type PanoramaRenderedReview,
  type PanoramaSavedReviewSummary,
  type PanoramaUiSettings,
  panoramaSavedReviewSummarySchema,
} from '../schemas/computational-merge/panoramaUiSchemas';

export const buildPanoramaSavedReviewSummary = ({
  outputPath,
  renderedReview,
  settings,
  sourcePaths,
}: {
  outputPath: string;
  renderedReview: PanoramaRenderedReview;
  settings: PanoramaUiSettings;
  sourcePaths: string[];
}): PanoramaSavedReviewSummary =>
  panoramaSavedReviewSummarySchema.parse({
    boundaryFillColor: renderedReview.boundary.fillColor,
    boundaryMode: settings.boundaryMode,
    capabilityLevel: 'runtime_apply_capable',
    crop: renderedReview.boundary.crop,
    exposureNormalizationSummary: renderedReview.exposureNormalizationSummary,
    outputDimensions: renderedReview.outputDimensions,
    outputPath,
    projection: settings.projection,
    seamReview: renderedReview.seamReview,
    sourceGeometry: renderedReview.sourceGeometry,
    sourceCount: renderedReview.sources.stitchedSourceIndices.length,
    sourceContribution: renderedReview.sourceContribution,
    sourceRefs: renderedReview.sources.stitchedSourceIndices.map((sourceIndex) => {
      const path = sourcePaths[sourceIndex] ?? `panorama-source-${sourceIndex}`;
      return {
        contentHash: hashStableJson({ path, sourceIndex }),
        graphRevision: `panorama_source_${sourceIndex}`,
        path,
        sourceIndex,
      };
    }),
    warningCodes: renderedReview.warningCodes,
  });

const hashStableJson = (value: unknown): string => `fnv1a32:${fnv1a32(stableJson(value))}`;

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
