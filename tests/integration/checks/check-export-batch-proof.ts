#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';

import { parseExportRecipes } from '../../../src/schemas/exportRecipeSchemas.ts';
import { buildExportQueueExecutionPlan, parseExportQueue } from '../../../src/schemas/exportQueueSchemas.ts';

const REPORT_PATH = 'docs/validation/export-batch-proof-2026-06-18.json';
const GENERATED_AT = '2026-06-18T00:00:00.000Z';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const proofOutputSchema = z
  .object({
    outputHash: hashSchema,
    outputPath: z.string().trim().min(1),
    recipeId: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
  })
  .strict();
const reportSchema = z
  .object({
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1279),
    proofHash: hashSchema,
    queue: z.object({
      activeJobIds: z.array(z.string().trim().min(1)),
      nextJobIdsAfterDrain: z.array(z.string().trim().min(1)),
      queuedJobIds: z.array(z.string().trim().min(1)),
    }),
    recipeCoverage: z.array(
      z.object({
        colorProfile: z.string().trim().min(1),
        fileFormat: z.string().trim().min(1),
        filenameTemplate: z.string().trim().min(1),
        id: z.string().trim().min(1),
        metadataPolicy: z.enum(['keep_metadata', 'strip_gps', 'strip_metadata']),
        resize: z.string().trim().min(1),
      }),
    ),
    schemaVersion: z.literal(1),
    simulatedOutputs: z.array(proofOutputSchema).min(1),
    status: z.literal('synthetic_export_artifact_gate'),
  })
  .strict();

const update = process.argv.includes('--update');
for (const command of [
  ['bun', 'tests/integration/checks/check-export-recipe-fixtures.ts'],
  ['bun', 'tests/integration/checks/check-export-queue-fixtures.ts'],
  ['bun', 'tests/integration/checks/check-export-recipes-ui.ts'],
]) {
  run(command);
}

const recipes = parseExportRecipes(await Bun.file('fixtures/export/export-recipes.json').json());
const queue = parseExportQueue(await Bun.file('fixtures/export/export-queue.json').json());
const plan = buildExportQueueExecutionPlan(queue);
const drainedQueue = structuredClone(queue);
const runningJob = drainedQueue.jobs.find((job) => job.id === 'export-job-running');
if (runningJob === undefined) throw new Error('Missing running export job.');
drainedQueue.activeJobId = null;
runningJob.completedAt = '2026-06-14T08:06:00.000Z';
runningJob.progress.current = runningJob.progress.total;
runningJob.status = 'succeeded';
const drainedPlan = buildExportQueueExecutionPlan(drainedQueue);

const recipeCoverage = recipes.map((recipe) => ({
  colorProfile: recipe.colorProfile,
  fileFormat: recipe.fileFormat,
  filenameTemplate: recipe.filenameTemplate,
  id: recipe.id,
  metadataPolicy: recipe.keepMetadata ? (recipe.stripGps ? 'strip_gps' : 'keep_metadata') : 'strip_metadata',
  resize: recipe.enableResize ? `${recipe.resizeMode}:${recipe.resizeValue}` : 'original',
}));
const queuedJob = queue.jobs.find((job) => job.id === 'export-job-queued');
if (queuedJob === undefined) throw new Error('Missing queued export job.');
const simulatedOutputs = queuedJob.sourcePaths.map((sourcePath) => {
  const baseName =
    sourcePath
      .split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/u, '') ?? 'unknown';
  const outputPath = `${queuedJob.outputTarget}/${baseName}_client.tiff`;
  return {
    outputHash: hashString(JSON.stringify({ outputPath, recipe: queuedJob.recipe, sourcePath })),
    outputPath,
    recipeId: queuedJob.recipe.recipeId,
    sourcePath,
  };
});
const report = reportSchema.parse({
  generatedAt: GENERATED_AT,
  issue: 1279,
  proofHash: hashString(JSON.stringify({ drainedPlan, plan, recipeCoverage, simulatedOutputs })),
  queue: {
    activeJobIds: plan.activeJobIds,
    nextJobIdsAfterDrain: drainedPlan.nextJobIds,
    queuedJobIds: plan.queuedJobIds,
  },
  recipeCoverage,
  schemaVersion: 1,
  simulatedOutputs,
  status: 'synthetic_export_artifact_gate',
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('export batch proof updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:export-batch-proof:update.`);
}

const existingReport = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:export-batch-proof:update.`);
}

console.log(`export batch proof ok (${report.simulatedOutputs.length} outputs)`);

function run(command: string[]): void {
  const result = Bun.spawnSync(command, { stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    console.error(`${command.join(' ')} failed`);
    console.error(
      [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
        .join('\n')
        .split('\n')
        .slice(-20)
        .join('\n'),
    );
    process.exit(result.exitCode);
  }
}

function hashString(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
