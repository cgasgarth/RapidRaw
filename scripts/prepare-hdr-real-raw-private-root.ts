#!/usr/bin/env bun

import { runComputationalPrivateRootPrep } from './lib/computational-private-root-prep.ts';

await runComputationalPrivateRootPrep({
  expectedExtension: '.arw',
  featureFamily: 'hdr_merge',
  featureLabel: 'hdr',
  fixtureId: 'validation.computational-merge.hdr-bracket-alignment.v1',
  issue: 1509,
  minSources: 3,
  sourceLabel: 'ARW bracket files',
  tempPrefix: 'rawengine-hdr-private-root-',
});
