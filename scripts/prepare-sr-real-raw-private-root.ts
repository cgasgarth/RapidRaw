#!/usr/bin/env bun

import { runComputationalPrivateRootPrep } from './lib/computational-private-root-prep.ts';

await runComputationalPrivateRootPrep({
  expectedExtension: '.arw',
  featureFamily: 'super_resolution',
  featureLabel: 'SR',
  fixtureId: 'validation.computational-merge.super-resolution-subpixel.v1',
  issue: 1506,
  minSources: 4,
  preferredSourceFileNames: ['_DSC7861.ARW', '_DSC7862.ARW', '_DSC7863.ARW', '_DSC7864.ARW'],
  sourceLabel: 'project-owned Alaska ARW burst frames',
  tempPrefix: 'rawengine-sr-private-root-',
});
