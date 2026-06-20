#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/local-raw-ui-validation-harness-2026-06-20.json';
const GENERATED_AT = '2026-06-20T00:00:00.000Z';

const requiredPackageScripts = [
  'check:local-raw-ui-validation-harness',
  'prepare:public-raw-fixture-root',
  'check:public-raw-fixture-root',
  'check:visual-smoke:pr',
  'check:raw-open-edit-export-proof',
  'check:raw-open-edit-export-command-wrapper',
  'check:raw-open-edit-export-run-reports',
  'check:raw-open-edit-export-runtime-status',
  'check:focus-private-raw-ui-smoke',
  'check:sr-private-raw-ui-smoke',
  'check:computational-private-proof-runners',
] as const;

const packageJsonSchema = z
  .object({
    scripts: z.record(z.string(), z.string()),
  })
  .passthrough();

const harnessReportSchema = z
  .object({
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2364),
    requiredPackageScripts: z.array(
      z
        .object({
          command: z.string().trim().min(1),
          name: z.enum(requiredPackageScripts),
        })
        .strict(),
    ),
    runtimeArtifactContract: z
      .object({
        minimumArtifacts: z.array(z.string().trim().min(1)).min(6),
        privateRawRootEnv: z.literal('RAWENGINE_PRIVATE_RAW_ROOT'),
        requiresActualAppRun: z.literal(true),
        requiresRawSources: z.literal(true),
      })
      .strict(),
    schemaVersion: z.literal(1),
    status: z.literal('harness_ready_private_raw_execution_required'),
    validationLanes: z.array(
      z
        .object({
          commands: z.array(z.enum(requiredPackageScripts)).min(1),
          expectedEvidence: z.array(z.string().trim().min(1)).min(1),
          id: z.string().regex(/^[a-z0-9-]+$/u),
          purpose: z.string().trim().min(1),
          proofBoundary: z.string().trim().min(1),
        })
        .strict(),
    ),
  })
  .strict();

const update = process.argv.includes('--update');
const packageJson = packageJsonSchema.parse(await Bun.file('package.json').json());
const missingScripts = requiredPackageScripts.filter((name) => packageJson.scripts[name] === undefined);

if (missingScripts.length > 0) {
  throw new Error(`Missing package scripts: ${missingScripts.join(', ')}`);
}

const report = harnessReportSchema.parse({
  generatedAt: GENERATED_AT,
  issue: 2364,
  requiredPackageScripts: requiredPackageScripts.map((name) => ({
    command: packageJson.scripts[name],
    name,
  })),
  runtimeArtifactContract: {
    minimumArtifacts: [
      'RAW source path(s) and fixture id',
      'launched app URL or Tauri bundle identifier',
      'screenshot of the UI state before the edit',
      'screenshot of the UI state after the edit',
      'rendered/exported image artifact path',
      'machine-readable run report with hashes and status',
    ],
    privateRawRootEnv: 'RAWENGINE_PRIVATE_RAW_ROOT',
    requiresActualAppRun: true,
    requiresRawSources: true,
  },
  schemaVersion: 1,
  status: 'harness_ready_private_raw_execution_required',
  validationLanes: [
    {
      commands: ['prepare:public-raw-fixture-root', 'check:public-raw-fixture-root', 'check:visual-smoke:pr'],
      expectedEvidence: ['Public RAW fixture root is prepared.', 'Vite UI opens and captures a smoke screenshot.'],
      id: 'public-ui-smoke',
      purpose: 'Prove the local UI launch path is working before private RAW feature runs.',
      proofBoundary: 'Public smoke only; it does not prove private RAW output quality.',
    },
    {
      commands: [
        'check:raw-open-edit-export-proof',
        'check:raw-open-edit-export-command-wrapper',
        'check:raw-open-edit-export-run-reports',
        'check:raw-open-edit-export-runtime-status',
      ],
      expectedEvidence: [
        'Typed open/edit/export manifest is valid.',
        'Accepted private run reports are detected when present.',
      ],
      id: 'raw-open-edit-export',
      purpose: 'Keep the open/edit/export runtime proof path wired to typed manifests and report acceptance.',
      proofBoundary: 'Public mode is contract-only until private RAW reports are present.',
    },
    {
      commands: ['check:focus-private-raw-ui-smoke', 'check:sr-private-raw-ui-smoke'],
      expectedEvidence: [
        'Private RAW review panels render using local proof artifacts.',
        'Screenshots land under artifacts/visual-smoke.',
      ],
      id: 'private-raw-ui-review',
      purpose: 'Render private RAW computational review screens through the actual app UI.',
      proofBoundary:
        'Requires local private artifacts; missing artifacts must stay visible instead of being treated as pass.',
    },
    {
      commands: ['check:computational-private-proof-runners'],
      expectedEvidence: ['HDR, focus, panorama, and super-resolution private proof runners are invokable.'],
      id: 'computational-private-runners',
      purpose: 'Provide the reusable local lane for heavy RAW feature proof generation.',
      proofBoundary: 'Runner invocation alone is not a substitute for per-feature UI review and output validation.',
    },
  ],
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('local RAW UI validation harness updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:local-raw-ui-validation-harness:update.`);
}

const existingReport = harnessReportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:local-raw-ui-validation-harness:update.`);
}

console.log('local RAW UI validation harness ok');
