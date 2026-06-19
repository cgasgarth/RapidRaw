#!/usr/bin/env bun

import { runComputationalPrivateRootPrep } from './lib/computational-private-root-prep.ts';

await runComputationalPrivateRootPrep({
  expectedExtension: '.raf',
  featureFamily: 'panorama_stitch',
  featureLabel: 'panorama',
  fixtureId: 'validation.computational-merge.panorama-overlap.v1',
  issue: 1508,
  minSources: 3,
  sourceLabel: 'RAF overlap frames',
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
