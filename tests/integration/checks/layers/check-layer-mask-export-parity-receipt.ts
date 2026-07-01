#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import {
  deriveLayerMaskExportParityReceiptState,
  layerMaskExportParityReceiptSchema,
} from '../../../../src/utils/layers/layerMaskExportParityReceipt.ts';

const REPORT_PATH = 'docs/validation/proofs/layers-masks/layer-mask-real-raw-proof-2026-06-18.json';

const report = layerMaskExportParityReceiptSchema.parse(
  JSON.parse(readFileSync(REPORT_PATH, 'utf8')).exportParityReceipt,
);

if (report.parityStatus !== 'matched' || report.staleState !== 'current') {
  throw new Error('Refined layer mask export parity receipt must start matched/current.');
}

if (report.unmaskedPreviewHash === report.unrefinedPreviewHash) {
  throw new Error('Unrefined mask preview hash must differ from the unmasked preview hash.');
}

if (report.unrefinedPreviewHash === report.refinedPreviewHash) {
  throw new Error('Refined mask preview hash must differ from the unrefined mask preview hash.');
}

if (report.refinedPreviewHash === report.finalExportHash) {
  throw new Error('Saved export hash must be recorded independently from refined preview hash.');
}

const staleSourceReceipt = deriveLayerMaskExportParityReceiptState({
  current: {
    ...report,
    sourceGraphRevision: `${report.sourceGraphRevision}_next`,
  },
  receipt: report,
});

if (
  staleSourceReceipt.parityStatus !== 'stale_blocked' ||
  !staleSourceReceipt.staleReasons.includes('source_graph_revision_changed')
) {
  throw new Error('Source graph changes must block refined mask export parity acceptance.');
}

const staleMaskReceipt = deriveLayerMaskExportParityReceiptState({
  current: {
    ...report,
    refinedMaskContentHash: `${report.refinedMaskContentHash.slice(0, -1)}0`,
  },
  receipt: report,
});

if (
  staleMaskReceipt.parityStatus !== 'stale_blocked' ||
  !staleMaskReceipt.staleReasons.includes('mask_alpha_changed')
) {
  throw new Error('Refined mask alpha changes must block export parity acceptance.');
}

console.log(`layer mask export parity receipt ok (${report.receiptId})`);
