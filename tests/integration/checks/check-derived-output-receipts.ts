#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { DEFAULT_FOCUS_STACK_UI_SETTINGS } from '../../../src/schemas/focusStackUiSchemas.ts';
import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../../../src/schemas/hdrMergeUiSchemas.ts';
import {
  DEFAULT_PANORAMA_UI_SETTINGS,
  type PanoramaSavedReviewSummary,
} from '../../../src/schemas/panoramaUiSchemas.ts';
import { DEFAULT_SUPER_RESOLUTION_UI_SETTINGS } from '../../../src/schemas/superResolutionUiSchemas.ts';
import {
  derivedOutputReceiptSchema,
  type DerivedOutputReceipt,
} from '../../../src/schemas/derivedOutputReceiptSchemas.ts';
import { useUIStore } from '../../../src/store/useUIStore.ts';
import {
  buildFocusStackDerivedOutputReceipt,
  buildHdrDerivedOutputReceipt,
  buildPanoramaDerivedOutputReceipt,
  buildSuperResolutionDerivedOutputReceipt,
} from '../../../src/utils/derivedOutputReceipt.ts';
import { buildFocusStackOutputReviewWorkflow } from '../../../src/utils/focusStackOutputReview.ts';
import { buildHdrEditableHandoffSummary } from '../../../src/utils/hdrEditableHandoff.ts';
import { buildSuperResolutionOutputReviewWorkflow } from '../../../src/utils/superResolutionOutputReview.ts';

const failures: string[] = [];

const expect = (condition: boolean, message: string): void => {
  if (!condition) failures.push(message);
};

const assertReceipt = (label: string, receipt: DerivedOutputReceipt): void => {
  const parsed = derivedOutputReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    failures.push(`${label}: ${parsed.error.issues[0]?.message ?? 'invalid receipt'}`);
    return;
  }

  expect(
    receipt.receiptId.startsWith(`derived_output_${receipt.family}_`),
    `${label}: receipt id must include family.`,
  );
  expect(receipt.settingsHash.startsWith('fnv1a32:'), `${label}: settings hash must be stable hash.`);
  expect(receipt.outputContentHash.length > 0, `${label}: output hash must be present.`);
  expect(
    receipt.sourceContentHashes.length === receipt.sourceCount &&
      receipt.sourceGraphRevisions.length === receipt.sourceCount,
    `${label}: source lineage arrays must match source count.`,
  );

  if (receipt.openInEditorAction.state === 'available') {
    expect(receipt.openInEditorAction.path !== undefined, `${label}: available open action must include a path.`);
  }
};

const hdrReceipt = buildHdrDerivedOutputReceipt({
  handoff: buildHdrEditableHandoffSummary({
    outputPath: '/tmp/rawengine-hdr-output.tif',
    settings: DEFAULT_HDR_MERGE_UI_SETTINGS,
    sourcePaths: ['/tmp/hdr-0.dng', '/tmp/hdr-1.dng', '/tmp/hdr-2.dng'],
  }),
  settings: DEFAULT_HDR_MERGE_UI_SETTINGS,
});

const panoramaReview = {
  boundaryMode: DEFAULT_PANORAMA_UI_SETTINGS.boundaryMode,
  capabilityLevel: 'runtime_apply_capable',
  crop: { height: 1440, mode: 'auto_crop', preCropHeight: 1500, preCropWidth: 2600, width: 2400, x: 100, y: 20 },
  exposureNormalizationSummary: { appliedGainCount: 2, mode: 'scalar_overlap_luminance_gain_v1' },
  outputDimensions: { height: 1440, width: 2400 },
  outputPath: '/tmp/rawengine-panorama-output.tif',
  projection: DEFAULT_PANORAMA_UI_SETTINGS.projection,
  seamReview: {
    policy: 'adaptive_dp_feather_v1',
    reviewStatus: 'ready',
    seamCount: 2,
    seams: [
      { confidence: 'high', featherWidthPx: 48, fromSourceIndex: 0, p95ErrorPx: 0.6, toSourceIndex: 1 },
      { confidence: 'medium', featherWidthPx: 56, fromSourceIndex: 1, p95ErrorPx: 1.2, toSourceIndex: 2 },
    ],
  },
  sourceContribution: {
    excludedSourceCount: 0,
    regions: [
      { coverageRatio: 0.34, role: 'stitched', sourceIndex: 0 },
      { coverageRatio: 0.33, role: 'stitched', sourceIndex: 1 },
      { coverageRatio: 0.33, role: 'stitched', sourceIndex: 2 },
    ],
    stitchedSourceCount: 3,
  },
  sourceCount: 3,
  sourceRefs: [
    {
      contentHash: 'fnv1a32:panorama0',
      graphRevision: 'panorama_source_0',
      path: '/tmp/panorama-0.dng',
      sourceIndex: 0,
    },
    {
      contentHash: 'fnv1a32:panorama1',
      graphRevision: 'panorama_source_1',
      path: '/tmp/panorama-1.dng',
      sourceIndex: 1,
    },
    {
      contentHash: 'fnv1a32:panorama2',
      graphRevision: 'panorama_source_2',
      path: '/tmp/panorama-2.dng',
      sourceIndex: 2,
    },
  ],
  warningCodes: [],
} satisfies PanoramaSavedReviewSummary;

const panoramaReceipt = buildPanoramaDerivedOutputReceipt({
  review: panoramaReview,
  settings: DEFAULT_PANORAMA_UI_SETTINGS,
});

const focusReceipt = buildFocusStackDerivedOutputReceipt({
  review: buildFocusStackOutputReviewWorkflow({
    artifactPath: 'artifact_focus_stack_output',
    settings: DEFAULT_FOCUS_STACK_UI_SETTINGS,
    sourceCount: 4,
    sourcePaths: ['/tmp/focus-0.dng', '/tmp/focus-1.dng', '/tmp/focus-2.dng', '/tmp/focus-3.dng'],
  }),
  settings: DEFAULT_FOCUS_STACK_UI_SETTINGS,
});

const superResolutionReceipt = buildSuperResolutionDerivedOutputReceipt({
  review: buildSuperResolutionOutputReviewWorkflow({
    artifactPath: 'artifact_sr_output',
    settings: DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
    sourceCount: 6,
    sourcePaths: Array.from({ length: 6 }, (_value, index) => `/tmp/sr-${index}.dng`),
  }),
  settings: DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
});

const acceptedSuperResolutionReview = {
  ...buildSuperResolutionOutputReviewWorkflow({
    artifactPath: '/tmp/rawengine-sr-accepted-output.tif',
    settings: DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
    sourceCount: 3,
    sourcePaths: ['/tmp/sr-accepted-0.dng', '/tmp/sr-accepted-1.dng', '/tmp/sr-accepted-2.dng'],
  }),
  editableGate: 'ready',
  humanReviewStatus: 'passed',
  staleState: 'current',
  supportMap: {
    ...buildSuperResolutionOutputReviewWorkflow({
      artifactPath: '/tmp/rawengine-sr-accepted-output.tif',
      settings: DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
      sourceCount: 3,
      sourcePaths: ['/tmp/sr-accepted-0.dng', '/tmp/sr-accepted-1.dng', '/tmp/sr-accepted-2.dng'],
    }).supportMap,
    reviewStatus: 'apply_ready',
  },
  warningCodes: [],
} satisfies ReturnType<typeof buildSuperResolutionOutputReviewWorkflow>;

const acceptedSuperResolutionReceipt = buildSuperResolutionDerivedOutputReceipt({
  review: acceptedSuperResolutionReview,
  settings: DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
});

for (const [label, receipt] of [
  ['hdr', hdrReceipt],
  ['panorama', panoramaReceipt],
  ['focus stack', focusReceipt],
  ['super resolution', superResolutionReceipt],
  ['accepted super resolution', acceptedSuperResolutionReceipt],
] as const) {
  assertReceipt(label, receipt);
}

expect(hdrReceipt.openInEditorAction.state === 'available', 'HDR receipt must expose available editor handoff.');
expect(
  panoramaReceipt.openInEditorAction.state === 'available',
  'Panorama receipt must expose available editor handoff.',
);
expect(
  focusReceipt.openInEditorAction.path === undefined,
  'Focus stack deferred receipt must not fake an output path.',
);
expect(
  superResolutionReceipt.openInEditorAction.path === undefined,
  'SR unaccepted receipt must not fake an output path.',
);
expect(
  acceptedSuperResolutionReceipt.openInEditorAction.state === 'available',
  'Accepted SR receipt must expose available editor handoff.',
);
expect(
  acceptedSuperResolutionReceipt.openInEditorAction.path === acceptedSuperResolutionReview.artifactPath,
  'Accepted SR receipt must hand off the accepted artifact path.',
);
expect(
  acceptedSuperResolutionReceipt.sourceContentHashes.join(',') ===
    acceptedSuperResolutionReview.sourceRefs.map((source) => source.contentHash).join(','),
  'SR receipt must retain review source content hashes.',
);
expect(
  acceptedSuperResolutionReceipt.sourceGraphRevisions.join(',') ===
    acceptedSuperResolutionReview.sourceRefs.map((source) => source.graphRevision).join(','),
  'SR receipt must retain review source graph revisions.',
);
expect(
  focusReceipt.sourceGraphRevisions.join(',') ===
    'focus_stack_source_0,focus_stack_source_1,focus_stack_source_2,focus_stack_source_3',
  'Focus receipt must retain source graph revisions.',
);

useUIStore.getState().clearDerivedOutputReceipts();
useUIStore.getState().upsertDerivedOutputReceipt(hdrReceipt);
useUIStore.getState().upsertDerivedOutputReceipt(panoramaReceipt);
const storedReceipts = useUIStore.getState().derivedOutputReceipts;
expect(
  storedReceipts[hdrReceipt.receiptId]?.outputContentHash === hdrReceipt.outputContentHash,
  'Store must retain HDR receipt.',
);
expect(
  storedReceipts[panoramaReceipt.receiptId]?.openInEditorAction.path === panoramaReceipt.openInEditorAction.path,
  'Store must retain panorama editor handoff path.',
);
expect(
  panoramaReceipt.sourceContentHashes.join(',') ===
    panoramaReview.sourceRefs.map((source) => source.contentHash).join(','),
  'Panorama receipt must retain saved source content hashes.',
);
expect(
  panoramaReceipt.sourceGraphRevisions.join(',') ===
    panoramaReview.sourceRefs.map((source) => source.graphRevision).join(','),
  'Panorama receipt must retain saved source graph revisions.',
);

const invalidOpenAction = derivedOutputReceiptSchema.safeParse({
  ...hdrReceipt,
  openInEditorAction: { label: 'Open output', state: 'available' },
});
expect(!invalidOpenAction.success, 'Available open action without path must be rejected.');

const invalidSourceCount = derivedOutputReceiptSchema.safeParse({
  ...hdrReceipt,
  sourceContentHashes: hdrReceipt.sourceContentHashes.slice(1),
});
expect(!invalidSourceCount.success, 'Source hash count mismatch must be rejected.');

const requiredPanelMarkers = [
  'data-testid="derived-output-receipt"',
  'data-derived-output-family',
  'data-output-content-hash',
  'data-source-content-hashes',
  'data-source-graph-revisions',
  'data-testid="derived-output-open-in-editor"',
];
const panelSource = readFileSync('src/components/modals/DerivedOutputReceiptPanel.tsx', 'utf8');
for (const marker of requiredPanelMarkers) {
  expect(panelSource.includes(marker), `Derived output receipt panel missing ${marker}.`);
}

const modalWiring = [
  ['src/components/modals/HdrModal.tsx', 'buildHdrDerivedOutputReceipt'],
  ['src/components/modals/PanoramaModal.tsx', 'buildPanoramaDerivedOutputReceipt'],
  ['src/components/modals/FocusStackModal.tsx', 'buildFocusStackDerivedOutputReceipt'],
  ['src/components/modals/SuperResolutionModal.tsx', 'buildSuperResolutionDerivedOutputReceipt'],
] as const;
for (const [file, builder] of modalWiring) {
  const source = readFileSync(file, 'utf8');
  expect(source.includes(builder), `${file}: missing ${builder} wiring.`);
  expect(source.includes('derivedOutputReceipt'), `${file}: missing derivedOutputReceipt render path.`);
  expect(source.includes('upsertDerivedOutputReceipt'), `${file}: missing shared store upsert path.`);
}

const hdrModalSource = readFileSync('src/components/modals/HdrModal.tsx', 'utf8');
for (const marker of [
  'const receipt = buildHdrDerivedOutputReceipt({ handoff, settings });',
  'upsertDerivedOutputReceipt(receipt);',
  'setSavedDerivedOutputReceiptId(receipt.receiptId);',
  'data-testid="hdr-derived-output-receipt-store-entry"',
  "data-hdr-derived-source-open-path={storedDerivedOutputReceipt.openInEditorAction.path ?? ''}",
]) {
  expect(hdrModalSource.includes(marker), `HDR modal missing applied derived-output persistence marker: ${marker}.`);
}

const panoramaModalSource = readFileSync('src/components/modals/PanoramaModal.tsx', 'utf8');
expect(panoramaModalSource.includes('data-source-paths'), 'Panorama saved review must expose source paths.');
expect(
  panoramaModalSource.includes('data-source-graph-revisions'),
  'Panorama saved review must expose source graph revisions.',
);
const appModalsSource = readFileSync('src/components/modals/AppModals.tsx', 'utf8');
expect(
  appModalsSource.includes('sourcePaths={panoramaModalState.stitchingSourcePaths}'),
  'App modal wiring must pass panorama source paths into saved receipt builder.',
);
expect(
  appModalsSource.includes('sourcePaths: focusStackModalState.sourcePaths'),
  'App modal wiring must pass focus source paths into preview receipt builder.',
);
const focusModalSource = readFileSync('src/components/modals/FocusStackModal.tsx', 'utf8');
expect(focusModalSource.includes('data-source-paths'), 'Focus stack handoff proof must expose source paths.');
expect(
  focusModalSource.includes('data-source-graph-revisions'),
  'Focus stack handoff proof must expose source graph revisions.',
);
expect(
  appModalsSource.includes('sourcePaths: superResolutionModalState.sourcePaths') &&
    appModalsSource.includes('sourcePaths={superResolutionModalState.sourcePaths}'),
  'App modal wiring must pass SR source paths into output review and modal receipt builder.',
);

const srModalSource = readFileSync('src/components/modals/SuperResolutionModal.tsx', 'utf8');
for (const marker of [
  'data-open-in-editor-path={openInEditorPath}',
  'data-export-handoff-ready={String(exportHandoffReady)}',
  'data-source-content-hashes={sourceContentHashesLabel}',
  'data-source-graph-revisions={sourceGraphRevisionsLabel}',
  'onOpenDerivedOutput: onOpenOutput',
]) {
  expect(srModalSource.includes(marker), `SR modal missing derived editable-source marker: ${marker}.`);
}

const reviewPanelSource = readFileSync('src/components/modals/ComputationalMergeReviewPanel.tsx', 'utf8');
expect(reviewPanelSource.includes('DerivedOutputReceiptPanel'), 'Review panel must render the shared receipt panel.');
expect(reviewPanelSource.includes('onOpenDerivedOutput'), 'Review panel must expose editor handoff callback.');
const uiStoreSource = readFileSync('src/store/useUIStore.ts', 'utf8');
expect(uiStoreSource.includes('derivedOutputReceipts'), 'UI store must expose derived output receipt records.');
expect(uiStoreSource.includes('upsertDerivedOutputReceipt'), 'UI store must upsert derived output receipt records.');

const enLocale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')) as {
  modals?: { derivedOutput?: Record<string, unknown> };
};
expect(enLocale.modals?.derivedOutput !== undefined, 'English locale must include derived output receipt copy.');

if (failures.length > 0) {
  console.error('derived output receipt validation failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('derived output receipts ok (4 families)');
