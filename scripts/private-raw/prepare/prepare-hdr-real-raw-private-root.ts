#!/usr/bin/env bun

import { runComputationalPrivateRootPrep } from '../../lib/computational-private-root-prep.ts';

await runComputationalPrivateRootPrep({
  expectedExtension: '.arw',
  featureFamily: 'hdr_merge',
  featureLabel: 'hdr',
  fixtureId: 'validation.computational-merge.hdr-bracket-alignment.v1',
  issue: 2062,
  minSources: 3,
  preferredSourceFileNames: ['_DSC7729.ARW', '_DSC7730.ARW', '_DSC7731.ARW'],
  sourceLabel: 'ARW bracket files',
  tempPrefix: 'rawengine-hdr-private-root-',
});
