#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { NEGATIVE_LAB_PROFILE_BROWSER_ROWS } from '../../../../src/hooks/editor/useNegativeLabProfileBrowser.ts';
import {
  buildNegativeLabBrowserProfileProvenanceHash,
  buildNegativeLabProfileComparisonRows,
} from '../../../../src/utils/negative-lab/negativeLabProfileComparison.ts';

const modalSource = await readFile('src/components/modals/negative-lab/NegativeConversionModal.tsx', 'utf8');
const gridSource = await readFile('src/components/modals/negative-lab/NegativeLabProfileComparisonGrid.tsx', 'utf8');
const visualSmokeSource = await readFile('scripts/proofs/capture-visual-smoke.ts', 'utf8');

const profileProvenanceHashById = new Map(
  NEGATIVE_LAB_PROFILE_BROWSER_ROWS.map((profile) => [
    profile.presetId,
    buildNegativeLabBrowserProfileProvenanceHash(profile),
  ]),
);
const rows = buildNegativeLabProfileComparisonRows({
  activeFrameLabel: 'negative-lab-rendered-candidate-check.CR3',
  currentParams: NEGATIVE_LAB_PROFILE_BROWSER_ROWS[0].params,
  profiles: NEGATIVE_LAB_PROFILE_BROWSER_ROWS,
  profileProvenanceHashById,
  queuedCount: 2,
  selectedPresetId: NEGATIVE_LAB_PROFILE_BROWSER_ROWS[0].presetId,
});

assert.ok(rows.length >= 2, 'profile comparison must expose at least two candidate rows');
assert.ok(
  new Set(rows.map((row) => row.selectedProfileSnapshot.profileProvenanceHash)).size >= 2,
  'profile candidates must carry distinct provenance hashes',
);

for (const marker of [
  'NEGATIVE_LAB_PROFILE_CANDIDATE_RENDER_LIMIT',
  'setRenderedProfileCandidatePreviewById',
  'Invokes.PreviewNegativeConversion',
  'buildParamsWithFrameOverrides(row.profile.params)',
  'backend_preview_returned_identical_pixels_for_candidate_params',
  'renderedPreviewByProfileId={renderedProfileCandidatePreviewById}',
]) {
  assert.ok(modalSource.includes(marker), `modal missing rendered candidate marker: ${marker}`);
}

for (const marker of [
  'interface NegativeLabRenderedProfileCandidatePreview',
  'data-preview-render-status={renderedPreview?.status ??',
  'data-image-hash={renderedPreview?.imageHash ??',
  'data-identical-output-reason={renderedPreview?.identicalOutputReason ??',
  'data-rendered-positive-preview={renderedPreview?.url !== null',
  'negative-lab-profile-comparison-rendered-preview-' + '$' + '{profile.presetId}',
]) {
  assert.ok(gridSource.includes(marker), `grid missing rendered candidate marker: ${marker}`);
}

for (const marker of [
  'Negative Lab rendered profile candidate proof expected at least 2 ready previews.',
  'distinct image hashes or identical reason',
  'preview_negative_conversion',
  'mutationBrowsingMutatesEditGraph: z.literal',
]) {
  assert.ok(visualSmokeSource.includes(marker), `visual smoke missing rendered candidate proof marker: ${marker}`);
}

console.log(`negative lab rendered profile candidates ok (${rows.length} rows, backend preview proof guarded)`);
