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
  tempPrefix: 'rawengine-panorama-private-root-',
});
