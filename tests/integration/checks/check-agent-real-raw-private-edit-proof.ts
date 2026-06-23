#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { z } from 'zod';

import { RawStatus, SortDirection } from '../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../src/store/useLibraryStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { runAgentCoreEditCommandBundle } from '../../../src/utils/agentCoreEditCommandBundle.ts';
import { planAgentEditRecipe } from '../../../src/utils/agentEditRecipePlanner.ts';

const REPORT_PATH = 'docs/validation/agent-real-raw-private-edit-proof-2026-06-22.json';
const PRIVATE_SOURCE = process.env.RAWENGINE_PRIVATE_RAW_SOURCE ?? '/Users/cgas/Pictures/Capture One/Alaska';
const selectedPathOverride = process.env.RAWENGINE_AGENT_PRIVATE_RAW_PATH;
const UPDATE_REPORT = process.argv.includes('--update');
const REQUIRE_ASSETS = process.argv.includes('--require-assets');

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const proofReportSchema = z
  .object({
    appliedGraphRevision: z.string().min(1),
    changedPixelCount: z.number().int().positive(),
    fixtureId: z.literal('agent.private-raw.local-alaska-edit.v1'),
    outputHash: z.string().min(1),
    prompt: z.string().min(1),
    recipeKind: z.enum(['brighten_flat_raw', 'warm_portrait_pop', 'cool_landscape_detail']),
    schemaVersion: z.literal(1),
    selectedRawBasename: z.string().min(1),
    sourceHashAfter: hashSchema,
    sourceHashBefore: hashSchema,
    sourceHashUnchanged: z.literal(true),
    validationMode: z.literal('agent_real_raw_private_runtime_apply'),
  })
  .strict();

const selectedPath = selectedPathOverride ?? (await firstRawPath(PRIVATE_SOURCE));
if (selectedPath === undefined) {
  const message = `agent real RAW private edit proof skipped (no RAW files under ${PRIVATE_SOURCE})`;
  if (REQUIRE_ASSETS) throw new Error(message);
  console.log(message);
  process.exit(0);
}

const beforeHash = await hashFile(selectedPath);
seedStores(selectedPath);

const prompt = 'Make this private Alaska RAW warmer with cleaner shadows and a polished contrast pop.';
const plan = planAgentEditRecipe(prompt);
const result = await runAgentCoreEditCommandBundle({
  operationId: 'agent_private_raw_3126',
  sessionId: 'agent-private-raw-proof-3126',
  steps: plan.steps,
});
const afterHash = await hashFile(selectedPath);

const report = proofReportSchema.parse({
  appliedGraphRevision: result.appliedGraphRevision,
  changedPixelCount: result.changedPixelCount,
  fixtureId: 'agent.private-raw.local-alaska-edit.v1',
  outputHash: result.outputHash,
  prompt,
  recipeKind: plan.recipeKind,
  schemaVersion: 1,
  selectedRawBasename: basename(selectedPath),
  sourceHashAfter: afterHash,
  sourceHashBefore: beforeHash,
  sourceHashUnchanged: beforeHash === afterHash,
  validationMode: 'agent_real_raw_private_runtime_apply',
});

if (UPDATE_REPORT) await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

const committedReport = proofReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (committedReport.fixtureId !== report.fixtureId || committedReport.validationMode !== report.validationMode) {
  throw new Error('Committed private RAW agent proof report does not match the runtime proof lane.');
}
if (REQUIRE_ASSETS && committedReport.sourceHashBefore !== report.sourceHashBefore) {
  throw new Error('Private RAW agent proof report is stale for the selected RAW input.');
}

console.log(`agent real RAW private edit proof ok (${basename(selectedPath)} -> ${result.outputHash})`);

async function firstRawPath(root: string): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const match = entries.find((entry) => entry.isFile() && /\.(arw|cr3|dng|nef)$/iu.test(entry.name));
  return match === undefined ? undefined : join(root, match.name);
}

async function hashFile(path: string): Promise<z.infer<typeof hashSchema>> {
  return hashSchema.parse(
    `sha256:${createHash('sha256')
      .update(await readFile(path))
      .digest('hex')}`,
  );
}

function seedStores(selectedPath: string): void {
  useLibraryStore.getState().setLibrary({
    activeAlbumId: 'album_agent_private_raw_proof',
    albumTree: [
      { id: 'album_agent_private_raw_proof', images: [selectedPath], name: 'Agent Private RAW', type: 'album' },
    ],
    currentFolderPath: PRIVATE_SOURCE,
    filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
    folderTrees: [],
    imageList: [
      {
        exif: { ISO: '800', LensModel: 'FE 35mm F1.4 GM' },
        is_edited: false,
        is_virtual_copy: false,
        modified: 1_781_928_126,
        path: selectedPath,
        rating: 4,
        tags: ['agent-private-raw-proof'],
      },
    ],
    imageRatings: { [selectedPath]: 4 },
    libraryActivePath: selectedPath,
    multiSelectedPaths: [selectedPath],
    pinnedFolderTrees: [],
    rootPaths: [PRIVATE_SOURCE],
    sortCriteria: { key: 'rating', label: 'Rating', order: SortDirection.Descending },
  });

  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    finalPreviewUrl: 'rawengine-preview://history_0/private-raw-before',
    hasRenderedFirstFrame: true,
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    selectedImage: {
      exif: { ISO: '800', LensModel: 'FE 35mm F1.4 GM' },
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:rawengine-private-original',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-private-thumb',
      width: 6000,
    },
  });
}
