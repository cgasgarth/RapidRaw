#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import {
  type DerivedOutputReceipt,
  derivedOutputReceiptSchema,
} from '../../../src/schemas/computational-merge/derivedOutputReceiptSchemas.ts';
import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../../../src/schemas/computational-merge/hdrMergeUiSchemas.ts';
import {
  DEFAULT_PANORAMA_UI_SETTINGS,
  type PanoramaSavedReviewSummary,
} from '../../../src/schemas/computational-merge/panoramaUiSchemas.ts';
import { DEFAULT_SUPER_RESOLUTION_UI_SETTINGS } from '../../../src/schemas/computational-merge/superResolutionUiSchemas.ts';
import { DEFAULT_FOCUS_STACK_UI_SETTINGS } from '../../../src/schemas/focus-stack/focusStackUiSchemas.ts';
import { useUIStore } from '../../../src/store/useUIStore.ts';
import {
  buildFocusStackDerivedOutputReceipt,
  buildHdrDerivedOutputReceipt,
  buildPanoramaDerivedOutputReceipt,
  buildSuperResolutionDerivedOutputReceipt,
  deriveDerivedOutputReceiptState,
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

  if (receipt.outputPath !== undefined) {
    expect(receipt.provenanceSidecar !== undefined, `${label}: exported output must include provenance sidecar.`);
    expect(
      receipt.provenanceSidecar?.receipt.receiptId === receipt.receiptId,
      `${label}: sidecar receipt id must match receipt.`,
    );
    expect(
      receipt.provenanceSidecar?.receipt.family === receipt.family,
      `${label}: sidecar family must match receipt.`,
    );
    expect(
      receipt.provenanceSidecar?.output.contentHash === receipt.outputContentHash,
      `${label}: sidecar output hash must match receipt.`,
    );
    expect(receipt.provenanceSidecar?.output.path === receipt.outputPath, `${label}: sidecar output path must match.`);
    expect(
      receipt.provenanceSidecar?.sidecarPath === `${receipt.outputPath}.rrdata`,
      `${label}: sidecar path must be colocated with export output.`,
    );
    expect(
      receipt.provenanceSidecar?.sourceState.map((source) => source.order).join(',') ===
        receipt.sourceContentHashes.map((_hash, index) => String(index)).join(','),
      `${label}: sidecar must retain source order.`,
    );
    expect(
      receipt.provenanceSidecar?.app.id === 'io.github.CyberTimon.RapidRAW',
      `${label}: sidecar must include app metadata.`,
    );
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

const acceptedFocusReview = {
  ...buildFocusStackOutputReviewWorkflow({
    artifactPath: '/tmp/rawengine-focus-accepted-output.tif',
    settings: DEFAULT_FOCUS_STACK_UI_SETTINGS,
    sourceCount: 3,
    sourcePaths: ['/tmp/focus-accepted-0.dng', '/tmp/focus-accepted-1.dng', '/tmp/focus-accepted-2.dng'],
  }),
  editableHandoff: {
    ...buildFocusStackOutputReviewWorkflow({
      artifactPath: '/tmp/rawengine-focus-accepted-output.tif',
      settings: DEFAULT_FOCUS_STACK_UI_SETTINGS,
      sourceCount: 3,
      sourcePaths: ['/tmp/focus-accepted-0.dng', '/tmp/focus-accepted-1.dng', '/tmp/focus-accepted-2.dng'],
    }).editableHandoff,
    status: 'ready',
  },
  haloReview: {
    ...buildFocusStackOutputReviewWorkflow({
      artifactPath: '/tmp/rawengine-focus-accepted-output.tif',
      settings: DEFAULT_FOCUS_STACK_UI_SETTINGS,
      sourceCount: 3,
      sourcePaths: ['/tmp/focus-accepted-0.dng', '/tmp/focus-accepted-1.dng', '/tmp/focus-accepted-2.dng'],
    }).haloReview,
    reviewStatus: 'apply_ready',
  },
} satisfies ReturnType<typeof buildFocusStackOutputReviewWorkflow>;

const acceptedFocusReceipt = buildFocusStackDerivedOutputReceipt({
  review: acceptedFocusReview,
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
  ['accepted focus stack', acceptedFocusReceipt],
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
expect(
  acceptedFocusReceipt.provenanceSidecar?.acceptedApplyId === acceptedFocusReview.editableHandoff.artifactId,
  'Accepted focus receipt must include accepted apply id in sidecar.',
);
expect(
  acceptedSuperResolutionReceipt.provenanceSidecar?.acceptedApplyId === acceptedSuperResolutionReview.outputArtifactId,
  'Accepted SR receipt must include accepted apply id in sidecar.',
);
expect(
  panoramaReceipt.provenanceSidecar?.warnings.join(',') === panoramaReview.warningCodes.join(','),
  'Panorama sidecar must retain warning codes.',
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

const settingsChangedReceipt = deriveDerivedOutputReceiptState({
  current: buildHdrDerivedOutputReceipt({
    handoff: buildHdrEditableHandoffSummary({
      outputPath: '/tmp/rawengine-hdr-output.tif',
      settings: { ...DEFAULT_HDR_MERGE_UI_SETTINGS, toneMapPreview: !DEFAULT_HDR_MERGE_UI_SETTINGS.toneMapPreview },
      sourcePaths: ['/tmp/hdr-0.dng', '/tmp/hdr-1.dng', '/tmp/hdr-2.dng'],
    }),
    settings: { ...DEFAULT_HDR_MERGE_UI_SETTINGS, toneMapPreview: !DEFAULT_HDR_MERGE_UI_SETTINGS.toneMapPreview },
  }),
  receipt: hdrReceipt,
});
expect(settingsChangedReceipt.staleState === 'stale', 'Settings hash changes must mark HDR receipts stale.');
expect(
  settingsChangedReceipt.staleReasons?.includes('settings_hash_changed') === true,
  'Settings hash changes must expose a stale reason.',
);

const reorderedSourceReceipt = deriveDerivedOutputReceiptState({
  current: buildPanoramaDerivedOutputReceipt({
    review: {
      ...panoramaReview,
      sourceRefs: [...panoramaReview.sourceRefs].reverse().map((source, sourceIndex) => ({
        ...source,
        sourceIndex,
      })),
    },
    settings: DEFAULT_PANORAMA_UI_SETTINGS,
  }),
  receipt: panoramaReceipt,
});
expect(reorderedSourceReceipt.staleState === 'stale', 'Source order changes must mark panorama receipts stale.');
expect(
  reorderedSourceReceipt.staleReasons?.includes('source_order_changed') === true,
  'Source order changes must expose a stale reason.',
);

const outputHashMismatchReceipt = deriveDerivedOutputReceiptState({
  current: {
    ...superResolutionReceipt,
    outputContentHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    receiptId: `${superResolutionReceipt.receiptId}_changed_output`,
  },
  receipt: superResolutionReceipt,
});
expect(outputHashMismatchReceipt.staleState === 'stale', 'Output hash mismatches must mark SR receipts stale.');
expect(
  outputHashMismatchReceipt.staleReasons?.includes('output_artifact_changed') === true,
  'Output hash mismatch must expose a stale reason.',
);

const requiredPanelMarkers = [
  'data-testid="derived-output-receipt"',
  'data-derived-output-review-tray="true"',
  'data-derived-output-review-family',
  'data-derived-output-family',
  'data-derived-output-validation-status',
  'data-output-content-hash',
  'data-sidecar-accepted-apply-id',
  'data-sidecar-accepted-dry-run-id',
  'data-sidecar-app-build-version',
  'data-sidecar-output-path',
  'data-sidecar-path',
  'data-sidecar-source-order',
  'data-sidecar-warning-codes',
  'data-source-content-hashes',
  'data-source-graph-revisions',
  'data-source-lineage-summary',
  'data-derived-output-stale-reasons',
  'data-derived-output-warning-count',
  'data-testid="derived-output-warning-list"',
  'data-testid="derived-output-stale-warning"',
  'data-testid="derived-output-open-in-editor"',
  'data-testid="derived-output-export-action"',
];
const panelSource = readFileSync('src/components/modals/computational-merge/DerivedOutputReceiptPanel.tsx', 'utf8');
for (const marker of requiredPanelMarkers) {
  expect(panelSource.includes(marker), `Derived output receipt panel missing ${marker}.`);
}

const modalWiring = [
  ['src/components/modals/computational-merge/HdrModal.tsx', 'buildHdrDerivedOutputReceipt'],
  ['src/components/modals/computational-merge/PanoramaModal.tsx', 'buildPanoramaDerivedOutputReceipt'],
  ['src/components/modals/computational-merge/FocusStackModal.tsx', 'buildFocusStackDerivedOutputReceipt'],
  ['src/components/modals/computational-merge/SuperResolutionModal.tsx', 'buildSuperResolutionDerivedOutputReceipt'],
] as const;
for (const [file, builder] of modalWiring) {
  const source = readFileSync(file, 'utf8');
  expect(source.includes(builder), `${file}: missing ${builder} wiring.`);
  expect(source.includes('derivedOutputReceipt'), `${file}: missing derivedOutputReceipt render path.`);
  expect(source.includes('upsertDerivedOutputReceipt'), `${file}: missing shared store upsert path.`);
}

const familyTrayMarkers = [
  [
    'src/components/modals/computational-merge/HdrModal.tsx',
    ['DerivedOutputReceiptPanel', 'onExportOutput={onOpenFile}', 'validationStatus=', 'warnings='],
  ],
  [
    'src/components/modals/computational-merge/PanoramaModal.tsx',
    ['DerivedOutputReceiptPanel', 'onExportOutput={onOpenFile}', 'validationStatus=', 'warnings='],
  ],
  [
    'src/components/modals/computational-merge/FocusStackModal.tsx',
    ['<ComputationalMergeReviewPanel', 'derivedOutputReceipt={visibleDerivedOutputReceipt}'],
  ],
  [
    'src/components/modals/computational-merge/SuperResolutionModal.tsx',
    ['<ComputationalMergeReviewPanel', 'derivedOutputReceipt={visibleDerivedOutputReceipt}'],
  ],
] as const;
for (const [file, markers] of familyTrayMarkers) {
  const source = readFileSync(file, 'utf8');
  for (const marker of markers) {
    expect(source.includes(marker), `${file}: missing shared derived-output review tray marker: ${marker}.`);
  }
}

const reviewPanelSource = readFileSync(
  'src/components/modals/computational-merge/ComputationalMergeReviewPanel.tsx',
  'utf8',
);
for (const marker of [
  'validationStatus={validationStatus}',
  'warnings={warnings}',
  'sourceLineageSummary=',
  'onExportOutput={onExportDerivedOutput}',
]) {
  expect(reviewPanelSource.includes(marker), `Review panel missing shared tray prop marker: ${marker}.`);
}

const hdrModalSource = readFileSync('src/components/modals/computational-merge/HdrModal.tsx', 'utf8');
for (const marker of [
  'const receipt = buildHdrDerivedOutputReceipt({',
  'upsertDerivedOutputReceipt(receipt);',
  'setSavedDerivedOutputReceiptId(receipt.receiptId);',
  'data-testid="hdr-derived-output-receipt-store-entry"',
  "data-hdr-derived-source-open-path={visibleDerivedOutputReceipt.openInEditorAction.path ?? ''}",
]) {
  expect(hdrModalSource.includes(marker), `HDR modal missing applied derived-output persistence marker: ${marker}.`);
}

for (const [file, marker] of [
  ['src-tauri/src/image_processing.rs', 'derived_output_provenance_sidecars'],
  ['src-tauri/src/derived_output_provenance.rs', 'build_derived_output_provenance_sidecar'],
  ['src-tauri/src/hdr_artifact_sidecar.rs', 'derived_output_provenance_sidecars'],
  ['src-tauri/src/panorama_stitching.rs', 'derived_output_provenance_sidecars'],
] as const) {
  expect(readFileSync(file, 'utf8').includes(marker), `${file}: missing derived output sidecar marker ${marker}.`);
}

const panoramaModalSource = readFileSync('src/components/modals/computational-merge/PanoramaModal.tsx', 'utf8');
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
const focusModalSource = readFileSync('src/components/modals/computational-merge/FocusStackModal.tsx', 'utf8');
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

const srModalSource = readFileSync('src/components/modals/computational-merge/SuperResolutionModal.tsx', 'utf8');
for (const marker of [
  'data-open-in-editor-path={openInEditorPath}',
  'data-export-handoff-ready={String(exportHandoffReady)}',
  'data-source-content-hashes={sourceContentHashesLabel}',
  'data-source-graph-revisions={sourceGraphRevisionsLabel}',
  'onOpenDerivedOutput: onOpenOutput',
]) {
  expect(srModalSource.includes(marker), `SR modal missing derived editable-source marker: ${marker}.`);
}

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
