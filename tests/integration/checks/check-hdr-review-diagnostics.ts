#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../../../src/schemas/hdrMergeUiSchemas.ts';
import { buildHdrBracketPreflight } from '../../../src/utils/hdrBracketPreflight.ts';
import { buildHdrReviewDiagnostics } from '../../../src/utils/hdrReviewDiagnostics.ts';

const acceptedPreflight = buildHdrBracketPreflight([
  { exif: { ExposureTime: '1/250', FNumber: '5.6', ISO: '100' }, path: '/tmp/hdr-under.nef' },
  { exif: { ExposureTime: '1/60', FNumber: '5.6', ISO: '100' }, path: '/tmp/hdr-mid.nef' },
  { exif: { ExposureTime: '1/15', FNumber: '5.6', ISO: '100' }, path: '/tmp/hdr-over.nef' },
]);
if (acceptedPreflight === null) throw new Error('Expected accepted HDR bracket preflight.');

const accepted = buildHdrReviewDiagnostics({
  bracketPreflight: acceptedPreflight,
  imageCount: 3,
  isMergeReady: true,
  settings: DEFAULT_HDR_MERGE_UI_SETTINGS,
});
if (accepted.reviewDecision !== 'accepted') throw new Error('Expected accepted diagnostics review decision.');
if (accepted.warningSeverity !== 'review') throw new Error('Tone-mapped preview should require review.');
if (accepted.alignment.confidencePercent < 70) throw new Error('Expected usable alignment confidence.');
if (!accepted.warningCodes.includes('tone_mapped_preview_review')) {
  throw new Error('Expected tone-mapped preview warning code.');
}

const rejected = buildHdrReviewDiagnostics({
  bracketPreflight: null,
  imageCount: 1,
  isMergeReady: false,
  settings: { ...DEFAULT_HDR_MERGE_UI_SETTINGS, alignmentMode: 'none', deghosting: 'off' },
});
if (rejected.reviewDecision !== 'rejected') throw new Error('Expected rejected diagnostics review decision.');
if (rejected.warningSeverity !== 'blocked') throw new Error('Expected blocked diagnostics severity.');
if (rejected.deghost.status !== 'review') throw new Error('Expected deghost review status.');

const modalSource = readFileSync('src/components/modals/computational-merge/HdrModal.tsx', 'utf8');
for (const marker of [
  'hdr-review-diagnostics-panel',
  'hdr-review-diagnostic-row',
  'hdr-deghost-review-gate',
  'hdr-deghost-motion-overlay',
  'hdr-deghost-review-approve',
  'data-review-decision={reviewDiagnostics.reviewDecision}',
  'data-warning-severity={reviewDiagnostics.warningSeverity}',
  'data-review-approved={String(isDeghostReviewApproved)}',
  'data-clipping-risk={reviewDiagnostics.tone.clippingRisk}',
  'data-motion-risk={reviewDiagnostics.deghost.motionRisk}',
  'modals.hdr.reviewDiagnosticsTitle',
  'modals.hdr.reviewDiagnosticsLimit',
]) {
  if (!modalSource.includes(marker)) {
    throw new Error(`HDR review diagnostics UI missing marker: ${marker}`);
  }
}

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
for (const key of [
  'reviewDiagnosticsTitle',
  'deghostReviewTitle',
  'deghostReviewApproveAction',
  'reviewAlignment',
  'reviewDeghost',
  'reviewTone',
  'reviewDiagnosticsLimit',
]) {
  if (typeof locale.modals?.hdr?.[key] !== 'string') {
    throw new Error(`Missing HDR review diagnostics locale key: ${key}`);
  }
}

console.log('hdr review diagnostics ok');
