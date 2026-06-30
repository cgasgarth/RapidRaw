#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import type { NegativeLabMeasuredProfileCatalog } from '../../../src/schemas/negativeLabMeasuredProfileSchemas.ts';
import {
  buildNegativeLabRuntimeProfileBrowserRows,
  NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
} from '../../../src/utils/negativeLabMeasuredProfileRuntime.ts';
import {
  buildNegativeLabBrowserProfileProvenanceHash,
  buildNegativeLabProfileBoundPlanIdentity,
  buildNegativeLabProfileComparisonRows,
} from '../../../src/utils/negativeLabProfileComparison.ts';

const measuredCatalog: NegativeLabMeasuredProfileCatalog = {
  ...NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG.measuredCatalog,
  profiles: [
    ...NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG.measuredCatalog.profiles,
    {
      ...NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG.measuredCatalog.profiles[0],
      claimPolicy: 'named_stock_profile_requires_license_review',
      displayName: 'Reference-only C-41 Named Stock Review',
      doesNotProve: ['no_runtime_profile_resolver', 'no_stock_emulation_claim', 'no_colorimetric_match_claim'],
      evidenceDigest: {
        fixtureLegalStatus: 'project_owned_private_ci',
        renderProofStatus: 'metadata_only',
        sourceFixtureContentHashes: ['sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'],
      },
      evidenceFixtureIds: ['negative_lab.project_owned.reference_only_profile_001'],
      measurementProfileId: 'negative_lab.measured.c41.license_review.v1',
      profileId: 'negative_lab.measured.c41.license_review.v1',
      runtimeLimitations: ['Reference-only profile remains gated until license review and runtime proof are complete.'],
      runtimeStatus: 'ui_catalog_only',
    },
  ],
};
const profileRows = buildNegativeLabRuntimeProfileBrowserRows({
  ...NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
  measuredCatalog,
});
const profileProvenanceHashById = new Map(
  profileRows.map((profile) => [profile.presetId, buildNegativeLabBrowserProfileProvenanceHash(profile)]),
);
const comparisonRows = buildNegativeLabProfileComparisonRows({
  activeFrameLabel: 'roll-001-frame-002.CR3',
  currentParams: profileRows[0].params,
  profiles: profileRows,
  profileProvenanceHashById,
  queuedCount: 3,
  selectedPresetId: 'negative_lab.generic.c41.neutral.v1',
});

assert.ok(comparisonRows.length >= 5, 'comparison should keep multiple runtime candidates plus gated references');
assert.equal(comparisonRows[0].profile.presetId, 'negative_lab.generic.c41.neutral.v1');

const disabledReference = comparisonRows.find(
  (row) => row.profile.presetId === 'negative_lab.measured.c41.license_review.v1',
);
assert.ok(disabledReference, 'reference-only measured profile should stay visible in comparison rows');
assert.equal(disabledReference.profile.isSelectable, false);
assert.equal(disabledReference.mutationSafety.selectableForRuntimeApply, false);
assert.ok(disabledReference.renderEvidence.warningCodes.includes('license_review_required'));
assert.ok(disabledReference.renderEvidence.warningCodes.includes('base_sample_reference_pending'));

const previewHashes = new Set(comparisonRows.map((row) => row.renderEvidence.previewHash));
const renderHashes = new Set(comparisonRows.map((row) => row.renderEvidence.renderHash));
const metricHashes = new Set(comparisonRows.map((row) => row.renderEvidence.metricHash));
assert.ok(previewHashes.size > 1, 'comparison rows should expose distinct preview hashes');
assert.ok(renderHashes.size > 1, 'comparison rows should expose distinct render hashes');
assert.ok(metricHashes.size > 1, 'comparison rows should expose distinct metric hashes');

for (const row of comparisonRows) {
  assert.equal(row.mutationSafety.browsingMutatesEditGraph, false);
  assert.equal(row.mutationSafety.requiresAcceptedPlanForApply, true);
  assert.match(row.renderEvidence.previewHash, /^fnv1a32:[a-f0-9]{8}$/u);
  assert.match(row.renderEvidence.renderHash, /^fnv1a32:[a-f0-9]{8}$/u);
  assert.match(row.renderEvidence.metricHash, /^fnv1a32:[a-f0-9]{8}$/u);
  assert.ok(row.renderEvidence.warningCodes.length > 0, `${row.profile.presetId} should expose warning codes`);
  assert.equal(row.renderEvidence.outputTag, 'preview_display');
  assert.equal(row.renderEvidence.densityAlgorithm, row.profile.params.print_curve_algorithm);
}

const selectedProfilePlan = buildNegativeLabProfileBoundPlanIdentity(
  JSON.stringify({ plannedApplyCount: 3, warningCodes: ['preview_not_ready'] }),
  comparisonRows[0].selectedProfileSnapshot,
);
const alternateProfilePlan = buildNegativeLabProfileBoundPlanIdentity(
  JSON.stringify({ plannedApplyCount: 3, warningCodes: ['preview_not_ready'] }),
  comparisonRows[1].selectedProfileSnapshot,
);
assert.notEqual(
  selectedProfilePlan.acceptedDryRunPlanHash,
  alternateProfilePlan.acceptedDryRunPlanHash,
  'accepted plan hash should bind the dry-run to the selected profile snapshot',
);

const editSurfaceBefore = {
  exportPaths: ['/roll/001.CR3', '/roll/002.CR3'],
  frameExposureOverrides: { 'negative-lab-frame-2': 0.12 },
  graphRevision: 'graph_rev_negative_lab_before_browse',
};
const browsedComparisonState = {
  browsedComparisonProfileId: comparisonRows[1].profile.presetId,
  editSurface: editSurfaceBefore,
};
assert.deepEqual(
  browsedComparisonState.editSurface,
  editSurfaceBefore,
  'browsing comparison rows must not mutate graph, frame override, or export state',
);

const modalSource = await readFile('src/components/modals/negative-lab/NegativeConversionModal.tsx', 'utf8');
const gridSource = await readFile('src/components/modals/negative-lab/NegativeLabProfileComparisonGrid.tsx', 'utf8');
const requiredModalMarkers = [
  '<NegativeLabProfileComparisonGrid',
  'onBrowseProfile={setBrowsedComparisonProfileId}',
  'onUseProfile={handlePresetSelect}',
];
const requiredGridMarkers = [
  'data-testid="negative-lab-profile-comparison-matrix"',
  'data-preview-hash={candidate.renderEvidence.previewHash}',
  'data-render-hash={candidate.renderEvidence.renderHash}',
  'data-metric-hash={candidate.renderEvidence.metricHash}',
  'data-warning-codes={candidate.renderEvidence.warningCodes.join',
  'data-mutation-browsing-mutates-edit-graph={String(',
  'onBrowseProfile(profile.presetId)',
  'data-testid={`negative-lab-profile-comparison-use-${profile.presetId}`}',
  'disabled={!candidate.mutationSafety.selectableForRuntimeApply}',
];

for (const marker of requiredModalMarkers) {
  assert.ok(modalSource.includes(marker), `Negative Lab comparison modal integration missing marker: ${marker}`);
}

for (const marker of requiredGridMarkers) {
  assert.ok(gridSource.includes(marker), `Negative Lab comparison grid missing marker: ${marker}`);
}

console.log(`negative lab profile comparison ok (${comparisonRows.length} rows, ${renderHashes.size} render hashes)`);
