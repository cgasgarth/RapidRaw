#!/usr/bin/env bun

import { strict as assert } from 'node:assert';

import type { SupportedTypes } from '../../../../src/components/ui/AppProperties';
import {
  getNegativeLabCommandPaletteDisabledReasonKey,
  getNegativeLabDisabledReasonKey,
  getNegativeLabSourceReadiness,
  isNegativeLabSupportedSourcePath,
} from '../../../../src/utils/negative-lab/negativeLabSourceReadiness';

const supportedTypes: SupportedTypes = {
  nonRaw: ['jpg', 'jpeg', 'png', 'tif', 'tiff'],
  raw: ['arw', 'cr3', 'dng', 'nef'],
};

assert.equal(isNegativeLabSupportedSourcePath('/library/alaska/frame-001.ARW', supportedTypes), true);
assert.equal(isNegativeLabSupportedSourcePath('/library/scans/frame-002.tiff?vc=copy-1', supportedTypes), true);
assert.equal(isNegativeLabSupportedSourcePath('/library/notes/frame-003.txt', supportedTypes), false);

const supportedReadiness = getNegativeLabSourceReadiness(
  ['/library/alaska/frame-001.ARW', '/library/scans/frame-002.tiff'],
  supportedTypes,
);
assert.equal(supportedReadiness.isReady, true);
assert.deepEqual(supportedReadiness.targetPaths, ['/library/alaska/frame-001.ARW', '/library/scans/frame-002.tiff']);
assert.equal(getNegativeLabDisabledReasonKey(supportedReadiness), null);
assert.equal(getNegativeLabCommandPaletteDisabledReasonKey(supportedReadiness), null);

const emptyReadiness = getNegativeLabSourceReadiness([], supportedTypes);
assert.equal(emptyReadiness.isReady, false);
assert.equal(getNegativeLabDisabledReasonKey(emptyReadiness), 'negativeLabEntryPoints.disabled.noSelection');
assert.equal(
  getNegativeLabCommandPaletteDisabledReasonKey(emptyReadiness),
  'modals.commandPalette.unavailable.selectSource',
);

const unsupportedReadiness = getNegativeLabSourceReadiness(
  ['/library/alaska/frame-001.ARW', '/library/notes/frame-003.txt'],
  supportedTypes,
);
assert.equal(unsupportedReadiness.isReady, false);
assert.deepEqual(unsupportedReadiness.unsupportedPaths, ['/library/notes/frame-003.txt']);
assert.equal(getNegativeLabDisabledReasonKey(unsupportedReadiness), 'negativeLabEntryPoints.disabled.unsupported');
assert.equal(
  getNegativeLabCommandPaletteDisabledReasonKey(unsupportedReadiness),
  'modals.commandPalette.unavailable.negativeLabUnsupported',
);

const loadingReadiness = getNegativeLabSourceReadiness(['/library/alaska/frame-001.ARW'], null);
assert.equal(loadingReadiness.isReady, false);
assert.equal(getNegativeLabDisabledReasonKey(loadingReadiness), 'negativeLabEntryPoints.disabled.loading');
assert.equal(
  getNegativeLabCommandPaletteDisabledReasonKey(loadingReadiness),
  'modals.commandPalette.unavailable.negativeLabLoading',
);

console.log('negative lab entrypoint readiness ok');
