import {
  type ComputationalMergeReviewPanelDiagnosticCollection,
  computationalMergeReviewPanelDiagnosticCollectionSchema,
} from '../../schemas/computationalMergeReviewPanelSchemas';
import type { ComputationalMergePrivateSourceSet } from '../../schemas/computationalMergeSourceSetSchemas';
import { computationalMergeReviewThresholds } from './computationalMergeReviewThresholds';

export function buildComputationalMergeReviewPanelDiagnostics(
  sourceSets: ComputationalMergePrivateSourceSet[],
): ComputationalMergeReviewPanelDiagnosticCollection {
  return computationalMergeReviewPanelDiagnosticCollectionSchema.parse({
    diagnostics: sourceSets.map((sourceSet) => {
      const sourceIndices = sourceSet.sourceItems.map((item) => item.sourceIndex);
      return {
        applyResult: {
          commandId: `${sourceSet.fixtureId}.apply`,
          graphRevision: `${sourceSet.fixtureId}.synthetic.graph.apply`,
          outputArtifactId: `${sourceSet.fixtureId}.output`,
          previewArtifactId: `${sourceSet.fixtureId}.preview`,
          resultId: `${sourceSet.fixtureId}.synthetic.apply-result`,
        },
        artifactHandles: [
          {
            id: `${sourceSet.fixtureId}.preview`,
            kind: 'preview',
            source: 'synthetic_runtime',
          },
          {
            id: `${sourceSet.fixtureId}.output`,
            kind: 'output',
            source: 'synthetic_runtime',
          },
        ],
        dryRunPlan: {
          commandId: `${sourceSet.fixtureId}.dry_run`,
          graphRevision: `${sourceSet.fixtureId}.synthetic.graph.dry-run`,
          planHash: `${sourceSet.fixtureId}.synthetic.plan-hash`,
          planId: `${sourceSet.fixtureId}.synthetic.plan`,
          warnings: ['synthetic runtime only'],
        },
        featureFamily: sourceSet.featureFamily,
        fixtureId: sourceSet.fixtureId,
        implementationIssue: sourceSet.implementationIssue,
        nonClaims: [
          'not_raw_decode_verified',
          'not_ui_e2e_verified',
          'not_export_parity_verified',
          'not_quality_accepted',
        ],
        proofLevel: 'synthetic_runtime',
        proofStatus: sourceSet.proofStatus,
        qualityMetrics: syntheticMetricsFor(sourceSet.featureFamily),
        sourceSet: {
          expectedRawFormat: sourceSet.sourceItems[0]?.expectedRawFormat ?? 'raw',
          sourceCount: sourceSet.sourceItems.length,
          sourceIndices,
          sourcePaths: sourceSet.sourceItems.map((item) => item.localRelativePath),
        },
        uiIssue: sourceSet.uiIssue,
        warnings: [
          'Synthetic runtime proof does not prove RAW decode.',
          'UI E2E, export parity, and photographer acceptance remain open.',
        ],
      };
    }),
    issue: 1819,
    schemaVersion: 1,
  });
}

function syntheticMetricsFor(featureFamily: ComputationalMergePrivateSourceSet['featureFamily']) {
  switch (featureFamily) {
    case 'focus_stack': {
      const thresholds = computationalMergeReviewThresholds.focus_stack;
      return [
        {
          name: 'sharpnessGainRatio',
          passed: true,
          source: 'synthetic_runtime',
          threshold: thresholds.sharpnessGainRatio,
          value: 1.16,
        },
        {
          name: 'focusTransitionArtifactScore',
          passed: true,
          source: 'synthetic_runtime',
          threshold: thresholds.focusTransitionArtifactScore,
          value: 0.91,
        },
      ];
    }
    case 'super_resolution': {
      const thresholds = computationalMergeReviewThresholds.super_resolution;
      return [
        {
          name: 'alignmentInlierRatio',
          passed: true,
          source: 'synthetic_runtime',
          threshold: thresholds.alignmentInlierRatio,
          value: 0.66,
        },
        {
          name: 'superResolutionDetailGainRatio',
          passed: true,
          source: 'synthetic_runtime',
          threshold: thresholds.superResolutionDetailGainRatio,
          value: 1.21,
        },
      ];
    }
    case 'panorama_stitch': {
      const thresholds = computationalMergeReviewThresholds.panorama_stitch;
      return [
        {
          name: 'alignmentInlierRatio',
          passed: true,
          source: 'synthetic_runtime',
          threshold: thresholds.alignmentInlierRatio,
          value: 0.56,
        },
        {
          name: 'edgeContinuityScore',
          passed: true,
          source: 'synthetic_runtime',
          threshold: thresholds.edgeContinuityScore,
          value: 0.86,
        },
      ];
    }
  }
}
