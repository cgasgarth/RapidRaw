#!/usr/bin/env bun

import { runComputationalPrivateRootPrep } from './lib/computational-private-root-prep.ts';

await runComputationalPrivateRootPrep({
  expectedExtension: '.cr3',
  featureFamily: 'focus_stack',
  featureLabel: 'focus',
  fixtureId: 'validation.computational-merge.focus-plane-transition.v1',
  issue: 1507,
  minSources: 3,
  sourceLabel: 'CR3 focus frames',
  tempPrefix: 'rawengine-focus-private-root-',
});
