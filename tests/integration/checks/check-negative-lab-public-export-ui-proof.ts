#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

const EXPORT_REPORT_PATH = 'docs/validation/negative-lab-public-export-proof-2026-06-20.json';
const UI_PROOF_REPORT_PATH = 'docs/validation/negative-lab-public-export-ui-proof-2026-06-20.json';
const SCREENSHOT_PATH = 'artifacts/visual-smoke/negative-lab-public-export-review.png';
const update = process.argv.includes('--update');

const fnvHashSchema = z.string().regex(/^fnv1a64:[a-f0-9]{16}$/u);
const fnv32HashSchema = z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u);
const pngDimensionsSchema = z.object({ height: z.literal(960), width: z.literal(1440) }).strict();
const appliedProfileSchema = z
  .object({
    claimPolicy: z.literal('generic_starting_point_no_stock_claim'),
    displayName: z.literal('C-41 Portrait'),
    presetId: z.literal('negative_lab.generic.c41.portrait.v1'),
    processFamily: z.literal('c41_color_negative'),
    profileProvenanceHash: fnv32HashSchema,
    runtimeStatus: z.literal('runtime_parameter_applied'),
    stockFamilyDescriptor: z.literal('Soft portrait color negative'),
  })
  .strict();

const exportReportSchema = z
  .object({
    appliedProfile: appliedProfileSchema.passthrough(),
    doesNotProve: z.array(z.string().min(1)).min(1),
    fixtureId: z.literal('negative_lab.real.public.cc0_110_ericht_negative_001'),
    controlSurface: z
      .object({
        baseFog: z
          .object({
            sampleRect: z
              .object({ height: z.literal(0.35), width: z.literal(0.35), x: z.literal(0), y: z.literal(0) })
              .strict(),
            strength: z.number().min(0).max(1.25),
          })
          .strict(),
        density: z
          .object({
            blueWeight: z.number().positive(),
            contrast: z.number().positive(),
            exposure: z.number(),
            greenWeight: z.number().positive(),
            redWeight: z.number().positive(),
          })
          .strict(),
        export: z
          .object({
            acceptedDryRunPlanHash: fnv32HashSchema,
            acceptedDryRunPlanId: z.literal('negative_lab_batch_plan_2f4a91bc'),
            outputFormat: z.literal('jpeg_proof'),
            profileProvenanceHash: fnv32HashSchema,
            suffix: z.literal('Positive'),
          })
          .strict(),
        preset: appliedProfileSchema.pick({
          claimPolicy: true,
          displayName: true,
          presetId: true,
          processFamily: true,
        }),
      })
      .strict(),
    inputToOutputMeanAbsDelta: z.number().gt(0.01),
    metrics: z
      .object({
        changedPixelRatio: z.number().gt(0.05),
        inputToOutputMeanAbsDelta: z.number().gt(0.01),
      })
      .strict(),
    output: z
      .object({
        contentHash: fnvHashSchema,
        format: z.literal('jpeg_proof'),
        path: z.literal(
          'src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg',
        ),
      })
      .passthrough(),
    runtimeStatus: z.literal('public_negative_scan_positive_export_rendered'),
    sidecar: z
      .object({
        containsNegativeLabArtifact: z.literal(true),
        path: z.literal(
          'src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg.rrdata',
        ),
      })
      .passthrough(),
    source: z
      .object({
        license: z.literal('CC0 public fixture'),
        path: z.literal('fixtures/negative-lab/public/110-format-ericht-negative-cc0-320.jpg'),
      })
      .passthrough(),
  })
  .passthrough();

const uiProofReportSchema = z
  .object({
    doesNotProve: z.array(z.string().min(1)).min(1),
    exportProof: z
      .object({
        appliedProfile: appliedProfileSchema,
        changedPixelRatio: z.number().gt(0.05),
        contentHash: fnvHashSchema,
        inputToOutputMeanAbsDelta: z.number().gt(0.01),
        outputFormat: z.literal('jpeg_proof'),
        outputPath: z.literal(
          'src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg',
        ),
        sidecarPath: z.literal(
          'src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg.rrdata',
        ),
      })
      .strict(),
    controlSurface: exportReportSchema.shape.controlSurface,
    fixtureId: z.literal('negative_lab.real.public.cc0_110_ericht_negative_001'),
    issue: z.literal(2311),
    schemaVersion: z.literal(1),
    sourcePath: z.literal('fixtures/negative-lab/public/110-format-ericht-negative-cc0-320.jpg'),
    validationCommands: z
      .array(
        z.enum([
          'bun run check:negative-lab-public-export-review-smoke',
          'bun run check:negative-lab-public-export-ui-proof',
        ]),
      )
      .length(2),
    visualReview: z
      .object({
        dimensions: pngDimensionsSchema,
        scenario: z.literal('negative-lab-public-export-review'),
        screenshotPath: z.literal(SCREENSHOT_PATH),
        sourceAndOutputImagesLoaded: z.literal(true),
      })
      .strict(),
  })
  .strict();

function runCommand(command: string[]) {
  const result = Bun.spawnSync(command, { stderr: 'pipe', stdout: 'pipe' });
  if (result.success) return;

  const output = [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .slice(-30)
    .join('\n');
  throw new Error(`${command.join(' ')} failed:\n${output}`);
}

async function readPngDimensions(path: string) {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path} is not a PNG file.`);
  }

  return pngDimensionsSchema.parse({
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  });
}

runCommand(['bun', 'run', 'check:negative-lab-public-export-review-smoke']);

const exportReport = exportReportSchema.parse(JSON.parse(await readFile(EXPORT_REPORT_PATH, 'utf8')));
const screenshotDimensions = await readPngDimensions(SCREENSHOT_PATH);
const expectedReport = uiProofReportSchema.parse({
  doesNotProve: [
    'camera_raw_decode_path',
    'capture_one_class_quality',
    'commercial_converter_parity',
    'full_macos_app_manual_session',
    'icc_colorimetric_accuracy',
    'raw_scan_input',
    'stock_library_maturity',
  ],
  exportProof: {
    appliedProfile: {
      claimPolicy: exportReport.appliedProfile.claimPolicy,
      displayName: exportReport.appliedProfile.displayName,
      presetId: exportReport.appliedProfile.presetId,
      processFamily: exportReport.appliedProfile.processFamily,
      profileProvenanceHash: exportReport.appliedProfile.profileProvenanceHash,
      runtimeStatus: exportReport.appliedProfile.runtimeStatus,
      stockFamilyDescriptor: exportReport.appliedProfile.stockFamilyDescriptor,
    },
    changedPixelRatio: exportReport.metrics.changedPixelRatio,
    contentHash: exportReport.output.contentHash,
    inputToOutputMeanAbsDelta: exportReport.metrics.inputToOutputMeanAbsDelta,
    outputFormat: exportReport.output.format,
    outputPath: exportReport.output.path,
    sidecarPath: exportReport.sidecar.path,
  },
  controlSurface: exportReport.controlSurface,
  fixtureId: exportReport.fixtureId,
  issue: 2311,
  schemaVersion: 1,
  sourcePath: exportReport.source.path,
  validationCommands: [
    'bun run check:negative-lab-public-export-review-smoke',
    'bun run check:negative-lab-public-export-ui-proof',
  ],
  visualReview: {
    dimensions: screenshotDimensions,
    scenario: 'negative-lab-public-export-review',
    screenshotPath: SCREENSHOT_PATH,
    sourceAndOutputImagesLoaded: true,
  },
});
const expectedJson = `${JSON.stringify(expectedReport, null, 2)}\n`;

if (update) {
  await writeFile(UI_PROOF_REPORT_PATH, expectedJson);
  console.log('negative lab public export UI proof updated');
  process.exit(0);
}

const committedReport = uiProofReportSchema.parse(JSON.parse(await readFile(UI_PROOF_REPORT_PATH, 'utf8')));
if (JSON.stringify(committedReport) !== JSON.stringify(expectedReport)) {
  throw new Error(
    `Negative Lab public export UI proof is stale. Run bun tests/integration/checks/check-negative-lab-public-export-ui-proof.ts --update`,
  );
}

console.log(
  `negative lab public export UI proof ok (${expectedReport.exportProof.outputFormat}, ${expectedReport.visualReview.dimensions.width}x${expectedReport.visualReview.dimensions.height})`,
);
