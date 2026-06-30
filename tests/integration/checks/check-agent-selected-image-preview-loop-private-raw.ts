#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

import { z } from 'zod';

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import { RawStatus, SortDirection } from '../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../src/store/useLibraryStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  applyAgentGlobalAdjustments,
  dryRunAgentGlobalAdjustments,
} from '../../../src/utils/agentAdjustmentApplyTool.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import { runAgentIterativeEditLoop } from '../../../src/utils/agentIterativeEditLoop.ts';

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
    previewArtifactIds: z.array(z.string().trim().min(1)).length(2),
    previewCacheKeys: z.array(z.string().trim().min(1)).length(2),
    previewPurposes: z.array(z.enum(['detail_review', 'refresh'])).length(2),
    previewRefreshCount: z.literal(2),
    privateArtifactHtml: z.string().startsWith(`${PRIVATE_ARTIFACT_DIR}/`),
    reviewStatus: z.literal('needs_user_review'),
    rollbackGraphRevision: z.literal('history_0'),
    schemaVersion: z.literal(1),
    selectedRawBasename: z.string().trim().min(1),
    sourceHashAfter: hashSchema,
    sourceHashBefore: hashSchema,
    sourceHashUnchanged: z.literal(true),
    stopReason: z.literal('completed'),
    toolNames: z.array(z.string().trim().min(1)).min(10),
    validationMode: z.literal('agent_selected_image_preview_loop_private_raw'),
  })
  .strict();

const publicReport = publicProofReportSchema.parse({
  acceptanceCriteria: [
    'Selects one private Alaska RAW in the editor and library stores before agent dispatch.',
    'Runs the existing iterative loop through dispatchAgentLiveEditorTool and rawEngineAppServerHost.',
    'Requires approved dry-run plan hashes before both mutating apply turns.',
    'Renders two distinct selected-image preview envelopes, including a second detail-review crop.',
    'Rolls the live editor history back to the session-start checkpoint after review.',
    'Hashes the private source RAW before and after the loop and requires no overwrite.',
  ],
  doesNotProve: [
    'Does not commit or publish private Alaska image pixels, RAW hashes, or per-file metadata.',
    'Does not prove a separate #4149 outer selected-image preview-loop command because this branch only exposes selected-image state and approved inner agent dispatch tools.',
    'Does not prove Capture One or Lightroom quality equivalence.',
    'Does not prove GPU/native decoder parity beyond the selected-image preview loop path exercised here.',
  ],
  fixtureId: 'agent.selected-image-preview-loop.private-alaska.v1',
  privateArtifactDir: PRIVATE_ARTIFACT_DIR,
  privateSourceDefault: DEFAULT_PRIVATE_SOURCE,
  proofStatus: 'public_contract_private_runtime_required',
  schemaVersion: 1,
  validationCommand:
    'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-agent-preview-loop-proof RAWENGINE_PRIVATE_RAW_SOURCE="/Users/cgas/Pictures/Capture One/Alaska" bun run check:agent-selected-image-preview-loop-private-raw -- --require-assets',
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

const result = await runAgentIterativeEditLoop({
  dryRunApprovals: acceptedApprovals,
  maxIterations: 4,
  operationId: 'agent_private_preview_loop',
  prompt: 'Brighten the private Alaska RAW, inspect the selected-image preview, then refine shadow detail.',
  requestId: 'agent-private-preview-loop',
  rollbackAfterReview: true,
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
});
const afterHash = await hashFile(selectedPath);
const state = useEditorStore.getState();
const toolNames = result.transcript.map((entry) => entry.toolName);
const auditTypes = result.auditEvents.map((event) => event.type);
const previewCacheKeys = result.previewRefreshes.map((preview) => preview.cacheKey);

const failures: string[] = [];
if (afterHash !== beforeHash) failures.push('private source RAW hash changed after preview loop');
if (state.selectedImage?.path !== selectedPath) failures.push('selected image path changed during proof');
if (state.historyIndex !== 0) failures.push(`rollback left historyIndex at ${state.historyIndex}`);
if (state.adjustments.exposure !== INITIAL_ADJUSTMENTS.exposure) failures.push('rollback did not restore exposure');
if (result.rollbackReceipt?.toolName !== 'rawengine.agent.history.rollback') {
  failures.push('loop did not emit rollback receipt');
}
if (new Set(previewCacheKeys).size !== 2) failures.push('preview iterations did not produce distinct cache keys');
for (const requiredTool of [
  'rawengine.agent.state.get',
  'rawengine.agent.adjustments.dry_run',
  'rawengine.agent.adjustments.apply',
  'rawengine.agent.preview.render',
  'rawengine.agent.preview.compare',
  'rawengine.agent.history.rollback',
]) {
  if (!toolNames.includes(requiredTool) && !result.auditEvents.some((event) => event.toolName === requiredTool)) {
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
  previewArtifactIds: result.previewRefreshes.map((preview) => preview.artifactId),
  previewCacheKeys,
  previewPurposes: result.previewRefreshes.map((preview) => preview.purpose),
  previewRefreshCount: result.previewRefreshCount,
  privateArtifactHtml: `${PRIVATE_ARTIFACT_DIR}/selected-image-preview-loop.html`,
  reviewStatus: result.reviewStatus,
  rollbackGraphRevision: result.rollbackReceipt?.graphRevision,
  schemaVersion: 1,
  selectedRawBasename: basename(selectedPath),
  sourceHashAfter: afterHash,
  sourceHashBefore: beforeHash,
  sourceHashUnchanged: beforeHash === afterHash,
  stopReason: result.stopReason,
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
