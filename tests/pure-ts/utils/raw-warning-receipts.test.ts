import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';

import type { RawDevelopmentReport } from '../../../src/schemas/imageLoaderSchemas.ts';
import { buildRawWarningChips } from '../../../src/utils/rawWarningReceipts.ts';

const legacyReport = {
  cameraProfile: {
    algorithmId: 'dual_illuminant_mired_v1',
    candidateCount: 1,
    illuminantEstimateConfidence: 'high',
    illuminantEstimateMethod: 'wb_coeff_ratio',
    status: 'interpolated',
    warningCodes: [],
  },
  demosaicPath: 'bayer_hq',
  processingProfile: 'balanced',
} satisfies RawDevelopmentReport;

describe('RAW warning receipts', () => {
  test('accepts a supported legacy report without a highlight-reconstruction receipt', () => {
    expect(buildRawWarningChips({ rawDevelopmentReport: legacyReport }, i18next.t)).toEqual([]);
  });
});
