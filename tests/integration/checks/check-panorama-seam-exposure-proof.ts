#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';

const SOURCE_REPORT_PATH = 'docs/validation/proofs/panorama/panorama-blend-exposure-proof-2026-06-18.json';
const REPORT_PATH = 'docs/validation/proofs/panorama-extra/panorama-seam-exposure-proof-2026-06-18.json';
const GENERATED_AT = '2026-06-18T00:00:00.000Z';
const MIN_CHANGED_PIXELS = 1;
const MAX_EXPOSURE_MEAN_DELTA = 0.001;
const MAX_SEAM_DELTA = 0.05;

const sourceReportSchema = z
  .object({
    cases: z.array(
      z
        .object({
          changedPixelCount: z.number().int().min(MIN_CHANGED_PIXELS),
          exposureCompensation: z.object({
            rightMeanAfter: z.number(),
            rightMeanBefore: z.number(),
          }),
          outputHash: z.string().trim().min(1),
          overlap: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }),
          seamBlend: z.object({
            blendMode: z.literal('feather'),
            maxDeltaFromUnblended: z.number().min(0).max(MAX_SEAM_DELTA),
            meanDeltaFromUnblended: z.number().min(0).max(MAX_SEAM_DELTA),
          }),
        })
        .strict()
        .passthrough(),
    ),
    validationMode: z.literal('panorama_blend_exposure_pixel_artifact'),
  })
  .strict()
  .passthrough();

const reportSchema = z
  .object({
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1929),
    proofHash: z.string().regex(/^[a-f0-9]{64}$/),
    schemaVersion: z.literal(1),
    sourceReportHash: z.string().regex(/^[a-f0-9]{64}$/),
    cases: z.array(
      z
        .object({
          changedPixelCount: z.number().int().min(MIN_CHANGED_PIXELS),
          exposureMeanDeltaAfterCompensation: z.number().min(0).max(MAX_EXPOSURE_MEAN_DELTA),
          outputHash: z.string().trim().min(1),
          overlapPixelCount: z.number().int().positive(),
          seamMaxDeltaFromUnblended: z.number().min(0).max(MAX_SEAM_DELTA),
          seamMeanDeltaFromUnblended: z.number().min(0).max(MAX_SEAM_DELTA),
        })
        .strict(),
    ),
    validationStatus: z.literal('synthetic_artifact_gate'),
  })
  .strict();

const update = process.argv.includes('--update');
run(['bun', 'tests/integration/checks/check-panorama-blend-exposure.ts']);
const sourceText = await Bun.file(SOURCE_REPORT_PATH).text();
const source = sourceReportSchema.parse(JSON.parse(sourceText));
const cases = source.cases.map((sourceCase) => ({
  changedPixelCount: sourceCase.changedPixelCount,
  exposureMeanDeltaAfterCompensation: Math.abs(sourceCase.exposureCompensation.rightMeanAfter - 0.45),
  outputHash: sourceCase.outputHash,
  overlapPixelCount: sourceCase.overlap.width * sourceCase.overlap.height,
  seamMaxDeltaFromUnblended: sourceCase.seamBlend.maxDeltaFromUnblended,
  seamMeanDeltaFromUnblended: sourceCase.seamBlend.meanDeltaFromUnblended,
}));
const sourceReportHash = hashString(sourceText);
const report = reportSchema.parse({
  cases,
  generatedAt: GENERATED_AT,
  issue: 1929,
  proofHash: hashString(JSON.stringify({ cases, sourceReportHash })),
  schemaVersion: 1,
  sourceReportHash,
  validationStatus: 'synthetic_artifact_gate',
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('panorama seam exposure proof updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:panorama-seam-exposure-proof:update.`);
}

const existingReport = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:panorama-seam-exposure-proof:update.`);
}

console.log(`panorama seam exposure proof ok (${report.cases.length} cases)`);

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
