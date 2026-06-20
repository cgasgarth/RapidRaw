#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/professional-workflow-status-2026-06-18.json';
const GENERATED_AT = '2026-06-18T00:00:00.000Z';

const commandSchema = z
  .object({
    command: z.string().trim().min(1),
    status: z.literal('passed'),
  })
  .strict();

const reportSchema = z
  .object({
    commands: z.array(commandSchema).min(1),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1857),
    proofHash: z.string().regex(/^[a-f0-9]{64}$/),
    schemaVersion: z.literal(1),
    status: z.literal('thin_e2e_workflow_smoke_validated'),
    summary: z.object({
      cullSession: z.literal('fixture_plan_validated'),
      deliveryReview: z.literal('manifest_validated'),
      exportQueue: z.literal('queue_plan_validated'),
      metadataSidecar: z.literal('runtime_temp_sidecar_validated'),
      sessionReload: z.literal('artifact_hash_validated'),
      uiScreenshots: z.literal('library_workflow_visual_smoke_validated'),
    }),
  })
  .strict();

const update = process.argv.includes('--update');
const commands = [
  'bun tests/integration/checks/check-library-session-fixtures.ts',
  'bun tests/integration/checks/check-session-import-reload-proof.ts',
  'bun tests/integration/checks/check-metadata-sidecar-workflow-proof.ts',
  'bun tests/integration/checks/check-export-queue-fixtures.ts',
  'bun tests/integration/checks/check-delivery-review-manifest.ts',
  'bun scripts/capture-visual-smoke.ts --scenario library-workflow',
];
for (const command of commands) {
  run(command.split(' '));
}
const summary = {
  cullSession: 'fixture_plan_validated',
  deliveryReview: 'manifest_validated',
  exportQueue: 'queue_plan_validated',
  metadataSidecar: 'runtime_temp_sidecar_validated',
  sessionReload: 'artifact_hash_validated',
  uiScreenshots: 'library_workflow_visual_smoke_validated',
} as const;
const report = reportSchema.parse({
  commands: commands.map((command) => ({ command, status: 'passed' })),
  generatedAt: GENERATED_AT,
  issue: 1857,
  proofHash: hashString(JSON.stringify({ commands, summary })),
  schemaVersion: 1,
  status: 'thin_e2e_workflow_smoke_validated',
  summary,
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('professional workflow status updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:professional-workflow-status:update.`);
}

const existingReport = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:professional-workflow-status:update.`);
}

console.log('professional workflow status ok (thin e2e)');

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
