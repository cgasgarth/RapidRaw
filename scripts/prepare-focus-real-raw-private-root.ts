#!/usr/bin/env bun

import { runComputationalPrivateRootPrep } from './lib/computational-private-root-prep.ts';

await runComputationalPrivateRootPrep({
  expectedExtension: '.arw',
  featureFamily: 'focus_stack',
  featureLabel: 'focus',
  fixtureId: 'validation.computational-merge.focus-plane-transition.v1',
  issue: 1507,
  minSources: 3,
  preferredSourceFileNames: ['_DSC7509.ARW', '_DSC7510.ARW', '_DSC7511.ARW'],
  sourceLabel: 'project-owned Alaska ARW focus frames',
  tempPrefix: 'rawengine-focus-private-root-',
});
