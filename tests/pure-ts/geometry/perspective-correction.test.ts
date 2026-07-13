import { expect, test } from 'bun:test';

import {
  perspectiveAnalysisResultSchema,
  perspectiveCorrectionSettingsSchema,
} from '../../../src/schemas/geometry/perspectiveSchemas.ts';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../../src/utils/adjustments.ts';

const identity = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
] as const;

test('perspective settings persist guided evidence and resolved plan through adjustment normalization', () => {
  const perspectiveCorrection = perspectiveCorrectionSettingsSchema.parse({
    amount: 65,
    cropPolicy: 'auto_crop',
    guides: [
      {
        class: 'vertical',
        endpointsSourceNormalized: [
          [0.2, 0.1],
          [0.1, 0.9],
        ],
        id: 'left',
        weight: 1,
      },
    ],
    mode: 'guided',
    resolvedPlan: {
      analysisIdentity: null,
      confidence: 0.91,
      correctedToSource: identity,
      fingerprint: 42,
      implementationVersion: 1,
      retainedArea: 0.78,
      sourceToCorrected: identity,
      suggestedCrop: { height: 0.8, width: 0.8, x: 0.1, y: 0.1 },
      validPolygon: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      warningCodes: [],
    },
  });
  const normalized = normalizeLoadedAdjustments({ ...INITIAL_ADJUSTMENTS, perspectiveCorrection });
  expect(normalized.perspectiveCorrection).toEqual(perspectiveCorrection);
});

test('analysis boundary rejects non-finite or unversioned transform evidence', () => {
  expect(
    perspectiveAnalysisResultSchema.safeParse({
      analysis: {
        confidence: 1,
        horizonAngleDegrees: 0,
        identity: {
          analysisDimensions: [1024, 768],
          implementationVersion: 1,
          lensGeometryFingerprint: 2,
          orientationFingerprint: 3,
          sourceRevision: 4,
        },
        lines: [],
        warningCodes: [],
      },
      receipt: {
        abstentionReason: null,
        conditionEstimate: Number.POSITIVE_INFINITY,
        guideCount: 0,
        horizontalGuideCount: 0,
        plan: {},
        residualDegreesP95: 0,
        verticalGuideCount: 0,
      },
    }).success,
  ).toBe(false);
});
