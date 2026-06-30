export const computationalMergeReviewThresholds = {
  focus_stack: {
    focusTransitionArtifactScore: 0.9,
    sharpnessGainRatio: 1.15,
  },
  panorama_stitch: {
    alignmentInlierRatio: 0.55,
    edgeContinuityScore: 0.85,
  },
  super_resolution: {
    alignmentInlierRatio: 0.65,
    superResolutionDetailGainRatio: 1.2,
  },
} as const;
