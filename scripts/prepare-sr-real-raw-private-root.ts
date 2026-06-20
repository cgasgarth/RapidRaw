#!/usr/bin/env bun

import { runComputationalPrivateRootPrep } from './lib/computational-private-root-prep.ts';

await runComputationalPrivateRootPrep({
  expectedExtension: '.arw',
  featureFamily: 'super_resolution',
  featureLabel: 'SR',
  fixtureId: 'validation.computational-merge.super-resolution-subpixel.v1',
  issue: 1506,
  minSources: 4,
  sourceLabel: 'project-owned ARW burst frames',
  tempPrefix: 'rawengine-sr-private-root-',
});
