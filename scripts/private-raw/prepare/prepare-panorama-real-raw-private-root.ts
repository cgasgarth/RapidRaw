#!/usr/bin/env bun

import { runComputationalPrivateRootPrep } from '../../lib/private-raw/computational-root-prep.ts';

await runComputationalPrivateRootPrep({
  expectedExtension: '.arw',
  featureFamily: 'panorama_stitch',
  featureLabel: 'panorama',
  fixtureId: 'validation.computational-merge.panorama-overlap.v1',
  issue: 1508,
  minSources: 3,
  preferredSourceFileNames: ['_DSC7853.ARW', '_DSC7854.ARW', '_DSC7855.ARW'],
  sourceLabel: 'project-owned ARW overlap frames',
  stressCandidate: {
    expectedExtension: '.arw',
    sourceLabel: 'ARW infrared panorama stress frames',
    sourceRelativePaths: [
      'private-fixtures/panorama/stress-pixls-ir-v1/frame-01.arw',
      'private-fixtures/panorama/stress-pixls-ir-v1/frame-02.arw',
      'private-fixtures/panorama/stress-pixls-ir-v1/frame-03.arw',
      'private-fixtures/panorama/stress-pixls-ir-v1/frame-04.arw',
    ],
  },
  tempPrefix: 'rawengine-panorama-private-root-',
});
