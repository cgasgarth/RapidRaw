#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';

import { z } from 'zod';

import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import { RawStatus, SortDirection } from '../../../../src/components/ui/AppProperties.tsx';
import { RawEngineAppServerHostToolName } from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../../src/store/useLibraryStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../../src/utils/agent/context/agentImageContextSnapshot.ts';
import {
  AGENT_RETOUCH_APPLY_TOOL_NAME,
  agentRetouchApplyResponseSchema,
} from '../../../../src/utils/agent/tools/agentRetouchApplyTool.ts';
import {
  buildRawEngineAppServerRouteCatalog,
  handleRawEngineAppServerHostRequestAsync,
} from '../../../../src/utils/rawEngineAppServerHost.ts';

const PUBLIC_REPORT_PATH = 'docs/validation/proofs/agent/agent-retouch-apply-private-raw-2026-07-01.json';
const PRIVATE_ARTIFACT_DIR = 'private-artifacts/validation/agent-retouch-apply';
const DEFAULT_PRIVATE_SOURCE = '/Users/cgas/Pictures/Capture One/Alaska';
const RAW_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.orf', '.raf', '.rw2']);

const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT;
const privateSource = process.env.RAWENGINE_PRIVATE_RAW_SOURCE ?? DEFAULT_PRIVATE_SOURCE;
const selectedPathOverride = process.env.RAWENGINE_AGENT_RETOUCH_PRIVATE_RAW_PATH;
const requireAssets = process.argv.includes('--require-assets');
const updateReport = process.argv.includes('--update');

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const fnvHashSchema = z.string().regex(/^fnv1a32:[0-9a-f]{8}$/u);
const publicProofReportSchema = z
  .object({
    acceptanceCriteria: z.array(z.string().trim().min(1)).min(5),
    doesNotProve: z.array(z.string().trim().min(1)).min(2),
    fixtureId: z.literal('agent.retouch-apply.private-alaska.v1'),
    issue: z.literal(4595),
    privateArtifactDir: z.literal(PRIVATE_ARTIFACT_DIR),
    privateSourceDefault: z.literal(DEFAULT_PRIVATE_SOURCE),
    proofStatus: z.literal('public_contract_private_runtime_required'),
    schemaVersion: z.literal(1),
    validationCommand: z.string().trim().min(1),
    validationMode: z.literal('agent_retouch_apply_private_raw'),
  })
  .strict();

const runtimeProofReportSchema = z
  .object({
    clone: z.object({
      changedPixelCount: z.number().int().positive(),
      layerId: z.literal('agent_private_clone_spot'),
      maskAlphaHash: fnvHashSchema,
      mode: z.literal('clone'),
      outputHash: fnvHashSchema,
      previewApplyParity: z.literal(true),
      provenanceEditableLayer: z.literal(true),
    }),
    fixtureId: z.literal('agent.retouch-apply.private-alaska.v1'),
    issue: z.literal(4595),
    privateArtifactHtml: z.string().startsWith(`${PRIVATE_ARTIFACT_DIR}/`),
    remove: z.object({
      changedPixelCount: z.number().int().positive(),
      layerId: z.literal('agent_private_remove_spot'),
      maskAlphaHash: fnvHashSchema,
      mode: z.literal('remove'),
      outputHash: fnvHashSchema,
      previewApplyParity: z.literal(true),
      provenanceEditableLayer: z.literal(true),
      resolvedRemoveSourceStatus: z.literal('ready'),
    }),
    routeRuntimeChecks: z.array(z.string().trim().min(1)).min(1),
    schemaVersion: z.literal(1),
    selectedRawBasename: z.string().trim().min(1),
    sourceHashAfter: hashSchema,
    sourceHashBefore: hashSchema,
    sourceHashUnchanged: z.literal(true),
    validationMode: z.literal('agent_retouch_apply_private_raw'),
  })
  .strict();

const publicReport = publicProofReportSchema.parse({
  acceptanceCriteria: [
    'Selects one local private Alaska RAW in the editor and library stores before retouch apply.',
    'Dispatches rawengine.agent.retouch.apply through the app-server host path for clone and remove operations.',
    'Requires editable retouch layer provenance for both clone and remove layers.',
    'Requires mask-aware non-no-op output deltas and preview/apply parity receipts.',
    'Hashes the private source RAW before and after apply and requires no overwrite.',
    'Writes only bounded local proof summaries under the ignored private artifact root.',
  ],
  doesNotProve: [
    'Does not commit or publish private Alaska image pixels, RAW hashes, or per-file metadata.',
    'Does not prove Capture One or Lightroom quality equivalence.',
    'Does not change or certify retouch algorithm quality beyond the existing runtime output proof.',
  ],
  fixtureId: 'agent.retouch-apply.private-alaska.v1',
  issue: 4595,
  privateArtifactDir: PRIVATE_ARTIFACT_DIR,
  privateSourceDefault: DEFAULT_PRIVATE_SOURCE,
  proofStatus: 'public_contract_private_runtime_required',
  schemaVersion: 1,
  validationCommand:
    'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-agent-retouch-apply-proof RAWENGINE_PRIVATE_RAW_SOURCE="/Users/cgas/Pictures/Capture One/Alaska" bun tests/integration/checks/agent/check-agent-retouch-apply.ts-private-raw -- --require-assets',
  validationMode: 'agent_retouch_apply_private_raw',
});

if (updateReport) {
  await writeFile(PUBLIC_REPORT_PATH, `${JSON.stringify(publicReport, null, 2)}\n`);
} else {
  const committedReport = publicProofReportSchema.parse(JSON.parse(await readFile(PUBLIC_REPORT_PATH, 'utf8')));
  if (JSON.stringify(committedReport) !== JSON.stringify(publicReport)) {
    throw new Error('Committed agent retouch private RAW proof report is stale; rerun with --update.');
  }
}

const selectedPath = selectedPathOverride ?? (await firstRawPath(privateSource));
if (selectedPath === undefined) {
  const message = `agent retouch apply private RAW proof skipped (no RAW files under ${privateSource})`;
  if (requireAssets) throw new Error(message);
  console.log(message);
  process.exit(0);
}
if (privateRoot === undefined) {
  const message = 'agent retouch apply private RAW proof skipped (RAWENGINE_PRIVATE_RAW_ROOT unset)';
  if (requireAssets) throw new Error(message);
  console.log(message);
  process.exit(0);
}

const sourceHashBefore = await hashFile(selectedPath);
seedStores(selectedPath);
const cloneSnapshot = buildAgentImageContextSnapshot();
const cloneResult = await dispatchRetouchApply({
  expectedRecipeHash: cloneSnapshot.initialPreview.recipeHash,
  featherRadiusPx: 22,
  layerId: 'agent_private_clone_spot',
  mode: 'clone',
  operationId: 'agent_private_clone_spot',
  radiusPx: 44,
  requestId: 'agent-private-retouch-clone',
  sessionId: 'agent-private-retouch-apply',
  sourcePoint: { x: 0.24, y: 0.32 },
  targetPoint: { x: 0.54, y: 0.51 },
});

const removeSnapshot = buildAgentImageContextSnapshot();
const removeResult = await dispatchRetouchApply({
  expectedRecipeHash: removeSnapshot.initialPreview.recipeHash,
  featherRadiusPx: 18,
  layerId: 'agent_private_remove_spot',
  mode: 'remove',
  operationId: 'agent_private_remove_spot',
  radiusPx: 36,
  requestId: 'agent-private-retouch-remove',
  searchRadiusMultiplier: 3,
  seed: 7,
  sessionId: 'agent-private-retouch-apply',
  targetPoint: { x: 0.48, y: 0.47 },
  userConfirmedGenerativeRetouch: true,
});
const sourceHashAfter = await hashFile(selectedPath);

const state = useEditorStore.getState();
const cloneLayer = state.adjustments.masks.find((mask) => mask.id === cloneResult.layerId);
const removeLayer = state.adjustments.masks.find((mask) => mask.id === removeResult.layerId);
const route = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_RETOUCH_APPLY_TOOL_NAME,
);
const failures: string[] = [];
if (sourceHashAfter !== sourceHashBefore) failures.push('private source RAW hash changed after retouch apply');
if (state.selectedImage?.path !== selectedPath) failures.push('selected private RAW changed during retouch proof');
if (state.historyIndex !== 2 || state.history.length !== 3) {
  failures.push(
    `expected two undoable retouch edits, got historyIndex=${state.historyIndex}, history=${state.history.length}`,
  );
}
if (cloneLayer?.retouchCloneSource?.provenance?.editableLayer !== true) {
  failures.push('clone retouch layer did not persist editable provenance');
}
if (removeLayer?.retouchRemoveSource?.provenance?.editableLayer !== true) {
  failures.push('remove retouch layer did not persist editable provenance');
}
if (removeLayer?.retouchRemoveSource?.status !== 'ready') {
  failures.push('remove retouch layer did not resolve a bounded source patch');
}
if (cloneResult.outputProof.applyDelta.changedPixelCount <= 0 || !cloneResult.outputProof.previewApplyParity) {
  failures.push('clone retouch output proof did not record changed preview/apply parity');
}
if (
  removeResult.outputProof.applyDelta.changedPixelCount <= 0 ||
  !removeResult.outputProof.previewApplyParity ||
  removeResult.outputProof.resolvedRemoveSourceStatus !== 'ready'
) {
  failures.push('remove retouch output proof did not record changed resolved-source parity');
}
if (
  route === undefined ||
  route.commandName !== AGENT_RETOUCH_APPLY_TOOL_NAME ||
  !route.runtimeCheckScripts.includes('check:agent-retouch-apply')
) {
  failures.push('agent retouch apply route does not advertise the public runtime check');
}
if (failures.length > 0) {
  throw new Error(`agent retouch apply private RAW proof failed:\n${failures.join('\n')}`);
}

const artifactDir = resolve(privateRoot, PRIVATE_ARTIFACT_DIR);
await mkdir(artifactDir, { recursive: true });
const runtimeReportPath = join(artifactDir, 'agent-retouch-apply-private-raw-report.json');
const htmlPath = join(artifactDir, 'agent-retouch-apply-private-raw.html');
const runtimeReport = runtimeProofReportSchema.parse({
  clone: {
    changedPixelCount: cloneResult.outputProof.applyDelta.changedPixelCount,
    layerId: cloneResult.layerId,
    maskAlphaHash: cloneResult.outputProof.maskAlphaHash,
    mode: cloneResult.mode,
    outputHash: cloneResult.outputProof.applyHash,
    previewApplyParity: cloneResult.outputProof.previewApplyParity,
    provenanceEditableLayer: cloneLayer?.retouchCloneSource?.provenance?.editableLayer,
  },
  fixtureId: 'agent.retouch-apply.private-alaska.v1',
  issue: 4595,
  privateArtifactHtml: `${PRIVATE_ARTIFACT_DIR}/agent-retouch-apply-private-raw.html`,
  remove: {
    changedPixelCount: removeResult.outputProof.applyDelta.changedPixelCount,
    layerId: removeResult.layerId,
    maskAlphaHash: removeResult.outputProof.maskAlphaHash,
    mode: removeResult.mode,
    outputHash: removeResult.outputProof.applyHash,
    previewApplyParity: removeResult.outputProof.previewApplyParity,
    provenanceEditableLayer: removeLayer?.retouchRemoveSource?.provenance?.editableLayer,
    resolvedRemoveSourceStatus: removeResult.outputProof.resolvedRemoveSourceStatus,
  },
  routeRuntimeChecks: route?.runtimeCheckScripts,
  schemaVersion: 1,
  selectedRawBasename: basename(selectedPath),
  sourceHashAfter,
  sourceHashBefore,
  sourceHashUnchanged: sourceHashBefore === sourceHashAfter,
  validationMode: 'agent_retouch_apply_private_raw',
});
await writeFile(runtimeReportPath, `${JSON.stringify(runtimeReport, null, 2)}\n`);
await writeFile(
  htmlPath,
  `<!doctype html><meta charset="utf-8"><title>Private agent retouch apply proof</title>
<h1>Private agent retouch apply proof</h1>
<dl>
<dt>Selected RAW</dt><dd>${runtimeReport.selectedRawBasename}</dd>
<dt>Source unchanged</dt><dd>${runtimeReport.sourceHashUnchanged}</dd>
<dt>Clone changed pixels</dt><dd>${runtimeReport.clone.changedPixelCount}</dd>
<dt>Remove changed pixels</dt><dd>${runtimeReport.remove.changedPixelCount}</dd>
<dt>Remove source status</dt><dd>${runtimeReport.remove.resolvedRemoveSourceStatus}</dd>
<dt>Route checks</dt><dd>${runtimeReport.routeRuntimeChecks.join(', ')}</dd>
</dl>`,
);

console.log(`agent retouch apply private RAW proof ok (${basename(selectedPath)} -> ${PRIVATE_ARTIFACT_DIR})`);

async function dispatchRetouchApply(args: unknown) {
  const response = await handleRawEngineAppServerHostRequestAsync({
    arguments: args,
    requestId: 'agent-private-retouch-dispatch',
    runtimeToolName: AGENT_RETOUCH_APPLY_TOOL_NAME,
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  });
  if (response.dispatchStatus !== 'completed' || response.result === undefined) {
    throw new Error(`agent retouch apply dispatch failed: ${response.message ?? 'missing result'}`);
  }
  return agentRetouchApplyResponseSchema.parse(response.result);
}

async function firstRawPath(root: string): Promise<string | undefined> {
  const files = await rawPaths(root);
  const nonTrash = files.filter((path) => !path.split(sep).includes('Trash'));
  return (nonTrash.length > 0 ? nonTrash : files).sort((a, b) => a.localeCompare(b))[0];
}

async function rawPaths(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await rawPaths(path)));
    } else if (entry.isFile() && RAW_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files;
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
    activeAlbumId: 'album_agent_retouch_apply_private_raw',
    albumTree: [
      {
        id: 'album_agent_retouch_apply_private_raw',
        images: [selectedPath],
        name: 'Agent Retouch Apply Private RAW',
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
        tags: ['agent-retouch-apply-private'],
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
    brushSettings: { feather: 42, size: 64, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-private-retouch-before',
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
      originalUrl: 'blob:rawengine-agent-private-retouch-original',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-agent-private-retouch-thumb',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
}
