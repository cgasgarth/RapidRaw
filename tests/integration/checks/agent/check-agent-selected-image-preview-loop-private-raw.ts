#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

import { z } from 'zod';

import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import { RawStatus, SortDirection } from '../../../../src/components/ui/AppProperties.tsx';
import { RawEngineAppServerHostToolName } from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../../src/store/useLibraryStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import {
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_TOOL_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
} from '../../../../src/utils/agent/context/agentCurrentImagePreviewLoop.ts';
import { buildAgentImageContextSnapshot } from '../../../../src/utils/agent/context/agentImageContextSnapshot.ts';
import {
  applyAgentGlobalAdjustments,
  dryRunAgentGlobalAdjustments,
} from '../../../../src/utils/agent/tools/agentAdjustmentApplyTool.ts';
import { handleRawEngineAppServerHostRequestAsync } from '../../../../src/utils/rawEngineAppServerHost.ts';

const PUBLIC_REPORT_PATH = 'docs/validation/proofs/agent/agent-selected-image-preview-loop-private-raw-2026-06-30.json';
const PRIVATE_ARTIFACT_DIR = 'private-artifacts/validation/agent-preview-loop';
const DEFAULT_PRIVATE_SOURCE = '/Users/cgas/Pictures/Capture One/Alaska';
const RAW_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.orf', '.raf', '.rw2']);

const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT;
const privateSource = process.env.RAWENGINE_PRIVATE_RAW_SOURCE ?? DEFAULT_PRIVATE_SOURCE;
const selectedPathOverride = process.env.RAWENGINE_AGENT_PRIVATE_RAW_PATH;
const updateReport = process.argv.includes('--update');
const requireAssets = process.argv.includes('--require-assets');

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const receiptHashSchema = z.string().regex(/^sha256:[a-f0-9]{16,64}$/u);
const publicProofReportSchema = z
  .object({
    acceptanceCriteria: z.array(z.string().trim().min(1)).min(4),
    doesNotProve: z.array(z.string().trim().min(1)).min(2),
    fixtureId: z.literal('agent.selected-image-preview-loop.private-alaska.v1'),
    privateArtifactDir: z.literal(PRIVATE_ARTIFACT_DIR),
    privateSourceDefault: z.literal(DEFAULT_PRIVATE_SOURCE),
    proofStatus: z.literal('public_contract_private_runtime_required'),
    schemaVersion: z.literal(1),
    validationCommand: z.string().trim().min(1),
    validationMode: z.literal('agent_selected_image_preview_loop_private_raw'),
  })
  .strict();

const runtimeProofReportSchema = z
  .object({
    acceptedDryRunPlanCount: z.literal(2),
    auditTypes: z.array(z.string().trim().min(1)).min(10),
    editCount: z.literal(2),
    finalRecipeHash: z.string().trim().min(1),
    fixtureId: z.literal('agent.selected-image-preview-loop.private-alaska.v1'),
    initialPreviewArtifactId: z.string().trim().min(1),
    initialPreviewReceiptHash: receiptHashSchema,
    initialPreviewReceiptLongEdgePx: z.literal(1536),
    initialPreviewReceiptQuality: z.literal(0.86),
    latestPreviewReceiptHash: receiptHashSchema,
    previewArtifactIds: z.array(z.string().trim().min(1)).length(2),
    previewPurposes: z.array(z.enum(['detail_review', 'refresh'])).length(2),
    previewReceiptHashes: z.array(receiptHashSchema).length(2),
    previewRefreshCount: z.literal(2),
    privateArtifactHtml: z.string().startsWith(`${PRIVATE_ARTIFACT_DIR}/`),
    reviewStatus: z.literal('needs_user_review'),
    rollbackGraphRevision: z.literal('history_0'),
    schemaVersion: z.literal(1),
    selectedRawBasename: z.string().trim().min(1),
    sourceHashAfter: hashSchema,
    sourceHashBefore: hashSchema,
    sourceHashUnchanged: z.literal(true),
    staleApplyRejections: z
      .array(z.enum(['stale preview artifact', 'stale preview receipt', 'stale selected-image dimensions']))
      .length(3),
    stopReason: z.literal('completed'),
    toolNames: z.array(z.string().trim().min(1)).min(10),
    validationMode: z.literal('agent_selected_image_preview_loop_private_raw'),
  })
  .strict();

const publicReport = publicProofReportSchema.parse({
  acceptanceCriteria: [
    'Selects one private Alaska RAW in the editor and library stores before agent dispatch.',
    'Runs the selected-image preview-loop wrapper through the app-server dispatch path.',
    'Requires approved dry-run plan hashes before both mutating apply turns.',
    'Requires an initial selected-image medium preview receipt before iterative edits.',
    'Renders two distinct selected-image preview envelopes, including a second detail-review crop.',
    'Rejects stale apply-review attempts against the private RAW-derived preview review.',
    'Rolls the live editor history back to the session-start checkpoint after review.',
    'Hashes the private source RAW before and after the loop and requires no overwrite.',
  ],
  doesNotProve: [
    'Does not commit or publish private Alaska image pixels, RAW hashes, or per-file metadata.',
    'Does not prove Capture One or Lightroom quality equivalence.',
    'Does not prove GPU/native decoder parity beyond the selected-image preview loop path exercised here.',
  ],
  fixtureId: 'agent.selected-image-preview-loop.private-alaska.v1',
  privateArtifactDir: PRIVATE_ARTIFACT_DIR,
  privateSourceDefault: DEFAULT_PRIVATE_SOURCE,
  proofStatus: 'public_contract_private_runtime_required',
  schemaVersion: 1,
  validationCommand:
    'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-agent-preview-loop-proof RAWENGINE_PRIVATE_RAW_SOURCE="/Users/cgas/Pictures/Capture One/Alaska" bun tests/integration/checks/agent/check-agent-selected-image-preview-loop-private-raw.ts -- --require-assets',
  validationMode: 'agent_selected_image_preview_loop_private_raw',
});

if (updateReport) {
  await writeFile(PUBLIC_REPORT_PATH, `${JSON.stringify(publicReport, null, 2)}\n`);
} else {
  const committedReport = publicProofReportSchema.parse(JSON.parse(await readFile(PUBLIC_REPORT_PATH, 'utf8')));
  if (JSON.stringify(committedReport) !== JSON.stringify(publicReport)) {
    throw new Error('Committed selected-image preview loop proof report is stale; rerun with --update.');
  }
}

const selectedPath = selectedPathOverride ?? (await firstRawPath(privateSource));
if (selectedPath === undefined) {
  const message = `agent selected-image preview loop private RAW proof skipped (no RAW files under ${privateSource})`;
  if (requireAssets) throw new Error(message);
  console.log(message);
  process.exit(0);
}
if (privateRoot === undefined) {
  const message = 'agent selected-image preview loop private RAW proof skipped (RAWENGINE_PRIVATE_RAW_ROOT unset)';
  if (requireAssets) throw new Error(message);
  console.log(message);
  process.exit(0);
}

const beforeHash = await hashFile(selectedPath);
seedStores(selectedPath);
const acceptedApprovals = await buildAcceptedDryRunApprovals();
seedStores(selectedPath);
const initialSnapshot = buildAgentImageContextSnapshot();
const commandRequest = {
  dryRunApprovals: acceptedApprovals,
  expectedGraphRevision: initialSnapshot.graphRevision,
  expectedPreviewHeight: initialSnapshot.initialPreview.height,
  expectedPreviewIdentity: initialSnapshot.previewIdentity,
  expectedPreviewWidth: initialSnapshot.initialPreview.width,
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  maxIterations: 4,
  operationId: 'agent_private_preview_loop',
  prompt: 'Brighten the private Alaska RAW, inspect the selected-image preview, then refine shadow detail.',
  requestId: 'agent-private-preview-loop',
  rollbackAfterReview: true,
  selectedImagePath: initialSnapshot.activeImagePath,
  sessionId: 'agent-private-preview-loop',
  steps: [
    { exposure: 0.22, highlights: -8 },
    {
      assistantRationale: 'After the selected-image preview refresh, lift shadows and inspect a detail crop.',
      exposure: 0.3,
      preview: {
        crop: { height: 0.34, width: 0.34, x: 0.25, y: 0.24 },
        maxPixelCount: 700_000,
        purpose: 'detail_review',
        zoom: { centerX: 0.48, centerY: 0.54, scale: 2.25 },
      },
      shadows: 16,
      userFollowUp: 'The selected-image preview still needs foreground separation; inspect detail before review.',
    },
  ],
} as const;

const loopDispatch = await dispatchSelectedImageLoop(commandRequest, 'agent-private-preview-loop-dispatch');
if (loopDispatch.dispatchStatus !== 'completed' || loopDispatch.result === undefined) {
  throw new Error(`agent selected-image preview loop dispatch failed: ${loopDispatch.message ?? 'missing result'}`);
}
const result = loopDispatch.result as AgentSelectedImagePreviewLoopResult;
const afterHash = await hashFile(selectedPath);
const state = useEditorStore.getState();
const toolNames = result.auditEventSummary.map((entry) => entry.toolName);
const auditTypes = result.auditEventSummary.map((event) => event.type);
const previewReceiptHashes = result.previewRefreshReceipts.map((receipt) => receipt.contentHash);
const latestPreviewArtifactId = result.previewLineage.at(-1)?.previewArtifactId;
const latestPreviewReceiptHash = result.previewRefreshReceipts.at(-1)?.contentHash;
if (latestPreviewArtifactId === undefined || latestPreviewReceiptHash === undefined) {
  throw new Error('agent selected-image preview loop private RAW proof missing latest preview apply evidence');
}
const staleApplyRejections = [
  await expectApplyRejects(
    {
      acceptedPreviewArtifactId: result.previewLineage[0]?.previewArtifactId ?? '',
      acceptedPreviewReceiptHash: latestPreviewReceiptHash,
      request: commandRequest,
      review: result,
    },
    'stale preview artifact',
    'agent-private-preview-loop-apply-stale-artifact',
  ),
  await expectApplyRejects(
    {
      acceptedPreviewArtifactId: latestPreviewArtifactId,
      acceptedPreviewReceiptHash: result.previewRefreshReceipts[0]?.contentHash ?? '',
      request: commandRequest,
      review: result,
    },
    'stale preview receipt',
    'agent-private-preview-loop-apply-stale-receipt',
  ),
  await expectApplyRejects(
    {
      acceptedPreviewArtifactId: latestPreviewArtifactId,
      acceptedPreviewReceiptHash: latestPreviewReceiptHash,
      request: commandRequest,
      review: { ...result, selectedImage: { ...result.selectedImage, width: result.selectedImage.width + 1 } },
    },
    'stale selected-image dimensions',
    'agent-private-preview-loop-apply-stale-dimensions',
  ),
];

const failures: string[] = [];
if (afterHash !== beforeHash) failures.push('private source RAW hash changed after preview loop');
if (state.selectedImage?.path !== selectedPath) failures.push('selected image path changed during proof');
if (state.historyIndex !== 0) failures.push(`rollback left historyIndex at ${state.historyIndex}`);
if (state.adjustments.exposure !== INITIAL_ADJUSTMENTS.exposure) failures.push('rollback did not restore exposure');
if (result.rollbackReceipt?.toolName !== 'rawengine.agent.history.rollback') {
  failures.push('loop did not emit rollback receipt');
}
if (
  result.initialPreviewReceipt.imagePath !== selectedPath ||
  result.initialPreviewReceipt.preview.longEdgePx !== 1536 ||
  result.initialPreviewReceipt.preview.quality !== 0.86 ||
  result.initialPreviewReceipt.preview.includesOriginalRaw !== false ||
  result.initialPreviewReceipt.proofContext.stale !== false
) {
  failures.push('initial selected-image medium preview receipt was missing or stale');
}
if (
  result.previewRefreshReceipts.length !== 2 ||
  result.previewRefreshReceipts.some(
    (receipt) =>
      receipt.imagePath !== selectedPath ||
      receipt.preview.includesOriginalRaw !== false ||
      receipt.proofContext.stale !== false,
  )
) {
  failures.push('iterative preview refresh receipts were missing private selected-image evidence');
}
if (new Set(previewReceiptHashes).size !== 2) failures.push('preview iterations did not produce distinct receipts');
if (
  result.compareArtifactIds.mediumPreview?.artifactId !== result.compareArtifactIds.currentArtifactId ||
  result.compareArtifactIds.mediumPreview?.contentHash !== result.compareArtifactIds.currentEvidence?.contentHash ||
  result.compareArtifactIds.mediumPreview === undefined ||
  Math.max(
    result.compareArtifactIds.mediumPreview.dimensions.width,
    result.compareArtifactIds.mediumPreview.dimensions.height,
  ) !== result.compareArtifactIds.mediumPreview.longEdgePx ||
  result.compareArtifactIds.mediumPreview?.graphRevision !== result.compareArtifactIds.currentEvidence?.graphRevision ||
  result.compareArtifactIds.mediumPreview?.longEdgePx !== 1536 ||
  result.compareArtifactIds.mediumPreview?.previewRef !== result.compareArtifactIds.currentEvidence?.previewRef ||
  result.compareArtifactIds.mediumPreview?.recipeHash !== result.compareArtifactIds.currentEvidence?.recipeHash ||
  result.compareArtifactIds.mediumPreview?.renderHash !== result.compareArtifactIds.currentEvidence?.renderHash ||
  result.compareArtifactIds.mediumPreview?.staleRecipeHash !== false
) {
  failures.push('medium preview artifact did not expose current selected-image handle/hash/dimensions/staleness');
}
for (const requiredTool of [
  'rawengine.agent.state.get',
  'rawengine.agent.adjustments.dry_run',
  'rawengine.agent.adjustments.apply',
  'rawengine.agent.preview.render',
  'rawengine.agent.preview.compare',
  'rawengine.agent.history.rollback',
]) {
  if (!toolNames.includes(requiredTool)) {
    failures.push(`missing runtime tool proof for ${requiredTool}`);
  }
}
if (failures.length > 0) {
  throw new Error(`agent selected-image preview loop private RAW proof failed:\n${failures.join('\n')}`);
}

const artifactDir = resolve(privateRoot, PRIVATE_ARTIFACT_DIR);
await mkdir(artifactDir, { recursive: true });
const runtimeReportPath = join(artifactDir, 'selected-image-preview-loop-report.json');
const htmlPath = join(artifactDir, 'selected-image-preview-loop.html');
const runtimeReport = runtimeProofReportSchema.parse({
  acceptedDryRunPlanCount: result.acceptedDryRunPlanCount,
  auditTypes,
  editCount: result.editCount,
  finalRecipeHash: result.finalRecipeHash,
  fixtureId: 'agent.selected-image-preview-loop.private-alaska.v1',
  initialPreviewArtifactId: result.initialPreviewArtifactId,
  initialPreviewReceiptHash: result.initialPreviewReceipt.contentHash,
  initialPreviewReceiptLongEdgePx: result.initialPreviewReceipt.preview.longEdgePx,
  initialPreviewReceiptQuality: result.initialPreviewReceipt.preview.quality,
  latestPreviewReceiptHash,
  previewArtifactIds: result.previewRefreshReceipts.map((receipt) => receipt.preview.artifactId),
  previewPurposes: result.previewRefreshReceipts.map((receipt) => receipt.preview.purpose),
  previewReceiptHashes,
  previewRefreshCount: result.previewRefreshCount,
  privateArtifactHtml: `${PRIVATE_ARTIFACT_DIR}/selected-image-preview-loop.html`,
  reviewStatus: result.reviewStatus,
  rollbackGraphRevision: result.rollbackReceipt?.graphRevision,
  schemaVersion: 1,
  selectedRawBasename: basename(selectedPath),
  sourceHashAfter: afterHash,
  sourceHashBefore: beforeHash,
  sourceHashUnchanged: beforeHash === afterHash,
  staleApplyRejections,
  stopReason: result.status === 'needs_user_review' ? 'completed' : result.status,
  toolNames,
  validationMode: 'agent_selected_image_preview_loop_private_raw',
});
await writeFile(runtimeReportPath, `${JSON.stringify(runtimeReport, null, 2)}\n`);
await writeFile(
  htmlPath,
  `<!doctype html><meta charset="utf-8"><title>Private selected-image preview loop</title>
<h1>Private selected-image preview loop</h1>
<dl>
<dt>Selected RAW</dt><dd>${runtimeReport.selectedRawBasename}</dd>
<dt>Source unchanged</dt><dd>${runtimeReport.sourceHashUnchanged}</dd>
<dt>Tool calls</dt><dd>${runtimeReport.toolNames.join(', ')}</dd>
<dt>Audit</dt><dd>${runtimeReport.auditTypes.join(' -> ')}</dd>
<dt>Preview artifacts</dt><dd>${runtimeReport.previewArtifactIds.join(' -> ')}</dd>
<dt>Preview purposes</dt><dd>${runtimeReport.previewPurposes.join(' -> ')}</dd>
<dt>Stale apply rejections</dt><dd>${runtimeReport.staleApplyRejections.join(' -> ')}</dd>
<dt>Rollback graph</dt><dd>${runtimeReport.rollbackGraphRevision}</dd>
<dt>Final recipe</dt><dd>${runtimeReport.finalRecipeHash}</dd>
</dl>`,
);

console.log(
  `agent selected-image preview loop private RAW proof ok (${basename(selectedPath)} -> ${PRIVATE_ARTIFACT_DIR})`,
);

async function buildAcceptedDryRunApprovals() {
  const approvals: Array<{
    acceptedPlanHash: string;
    acceptedPlanId: string;
    approvalState: 'approved';
    expectedGraphRevision: string;
    turn: number;
  }> = [];
  const steps = [
    { exposure: 0.22, highlights: -8 },
    { exposure: 0.3, shadows: 16 },
  ] as const;

  for (const [index, adjustments] of steps.entries()) {
    const snapshot = buildAgentImageContextSnapshot();
    const operationId = `agent_private_preview_loop_approval_${index + 1}`;
    const dryRun = await dryRunAgentGlobalAdjustments({
      adjustments,
      expectedGraphRevision: snapshot.graphRevision,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      operationId,
      requestId: `agent-private-preview-loop-approval-dry-run-${index + 1}`,
      sessionId: 'agent-private-preview-loop',
    });
    approvals.push({
      acceptedPlanHash: dryRun.dryRunPlanHash,
      acceptedPlanId: dryRun.dryRunPlanId,
      approvalState: 'approved',
      expectedGraphRevision: dryRun.sourceGraphRevision,
      turn: index + 2,
    });
    await applyAgentGlobalAdjustments({
      acceptedPlanHash: dryRun.dryRunPlanHash,
      acceptedPlanId: dryRun.dryRunPlanId,
      adjustments,
      expectedGraphRevision: dryRun.sourceGraphRevision,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      operationId,
      requestId: `agent-private-preview-loop-approval-apply-${index + 1}`,
      sessionId: 'agent-private-preview-loop',
    });
  }

  return approvals;
}

async function firstRawPath(root: string): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await firstRawPath(path);
      if (nested !== undefined) files.push(nested);
    } else if (entry.isFile() && RAW_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files.sort((a, b) => basename(a).localeCompare(basename(b)))[0];
}

async function hashFile(path: string): Promise<z.infer<typeof hashSchema>> {
  return hashSchema.parse(
    `sha256:${createHash('sha256')
      .update(await readFile(path))
      .digest('hex')}`,
  );
}

async function dispatchAgentTool(runtimeToolName: string, args: unknown, requestId: string) {
  return handleRawEngineAppServerHostRequestAsync({
    arguments: args,
    requestId,
    runtimeToolName,
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  });
}

async function dispatchSelectedImageLoop(args: unknown, requestId: string) {
  return dispatchAgentTool(AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME, args, requestId);
}

async function dispatchReviewedApply(args: unknown, requestId: string) {
  return dispatchAgentTool(AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_TOOL_NAME, args, requestId);
}

async function expectApplyRejects(args: unknown, expectedMessage: StaleApplyRejection, requestId: string) {
  const response = await dispatchReviewedApply(args, requestId);
  if (response.dispatchStatus !== 'rejected' || !response.message?.includes(expectedMessage)) {
    throw new Error(
      `expected apply-review rejection containing ${expectedMessage}, got ${response.dispatchStatus}: ${
        response.message ?? ''
      }`,
    );
  }
  return expectedMessage;
}

type StaleApplyRejection = 'stale preview artifact' | 'stale preview receipt' | 'stale selected-image dimensions';

type AgentSelectedImagePreviewLoopResult = {
  acceptedDryRunPlanCount: number;
  auditEventSummary: Array<{ toolName: string; type: string }>;
  compareArtifactIds: {
    currentArtifactId: string;
    currentEvidence?: {
      contentHash: string;
      graphRevision: string;
      previewRef: string;
      recipeHash: string;
      renderHash: string;
    };
    mediumPreview?: {
      artifactId: string;
      contentHash: string;
      dimensions: { height: number; width: number };
      graphRevision: string;
      longEdgePx: number;
      previewRef: string;
      recipeHash: string;
      renderHash: string;
      staleRecipeHash: boolean;
    };
  };
  editCount: number;
  finalRecipeHash: string;
  initialPreviewArtifactId: string;
  initialPreviewReceipt: {
    contentHash: string;
    imagePath: string;
    preview: {
      includesOriginalRaw: false;
      longEdgePx: number;
      quality: number;
    };
    proofContext: { stale: boolean };
  };
  previewLineage: Array<{ previewArtifactId: string }>;
  previewRefreshCount: number;
  previewRefreshReceipts: Array<{
    contentHash: string;
    imagePath: string;
    preview: { artifactId: string; includesOriginalRaw: false; purpose: 'detail_review' | 'refresh' };
    proofContext: { stale: boolean };
  }>;
  reviewStatus: 'needs_user_review';
  rollbackReceipt?: { graphRevision: string; toolName: string };
  selectedImage: { width: number };
  status: 'needs_user_review';
};

function seedStores(selectedPath: string): void {
  const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 12 : 2));
  useLibraryStore.getState().setLibrary({
    activeAlbumId: 'album_agent_selected_image_preview_loop',
    albumTree: [
      {
        id: 'album_agent_selected_image_preview_loop',
        images: [selectedPath],
        name: 'Agent Selected Image Preview Loop',
        type: 'album',
      },
    ],
    currentFolderPath: privateSource,
    filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
    folderTrees: [],
    imageList: [
      {
        exif: { ISO: '640', LensModel: 'private Alaska RAW' },
        is_edited: false,
        is_virtual_copy: false,
        modified: 1_782_684_000,
        path: selectedPath,
        rating: 5,
        tags: ['agent-selected-image-preview-loop-private'],
      },
    ],
    imageRatings: { [selectedPath]: 5 },
    libraryActivePath: selectedPath,
    multiSelectedPaths: [selectedPath],
    pinnedFolderTrees: [],
    rootPaths: [privateSource],
    sortCriteria: { key: 'rating', label: 'Rating', order: SortDirection.Descending },
  });
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-private-preview-before',
    hasRenderedFirstFrame: true,
    histogram: {
      [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
      [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
      [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
      [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
    },
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: {
      exif: { ISO: '640', LensModel: 'private Alaska RAW' },
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:rawengine-agent-private-original',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-agent-private-thumb',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
}
