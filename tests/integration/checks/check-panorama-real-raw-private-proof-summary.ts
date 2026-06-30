#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/proofs/panorama/panorama-real-raw-private-proof-2026-06-20.json';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const privateArtifactSchema = z
  .object({
    hash: sha256Schema,
    kind: z.string().trim().min(1),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const sourceHashSchema = z
  .object({
    hash: sha256Schema,
    localRelativePath: z.string().startsWith('private-fixtures/panorama/overlap-stitch-v1/'),
    path: z.string().startsWith('private-fixtures/panorama/overlap-stitch-v1/'),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const screenshotArtifactSchema = z
  .object({
    hash: sha256Schema,
    label: z.enum(['modal_before_apply', 'modal_after_apply', 'result_review', 'export_review']),
    path: z.string().startsWith('private-artifacts/validation/computational-merge/'),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const reportSchema = z
  .object({
    $schema: z.literal('https://rawengine.dev/schemas/private-raw-proof-summary-v1.json'),
    artifacts: z.array(privateArtifactSchema).min(8),
    doesNotProve: z
      .array(
        z.enum([
          'commercial_stitcher_parity',
          'final_panorama_quality_acceptance',
          'full_macos_manual_panorama_session',
          'full_resolution_app_server_apply',
        ]),
      )
      .length(4),
    e2eIssue: z.literal(1508),
    featureFamily: z.literal('panorama_stitch'),
    fixtureId: z.literal('validation.computational-merge.panorama-overlap.v1'),
    implementationIssue: z.literal(1508),
    proofBoundary: z.literal('private_raw_runtime_app_server_apply_and_ui_smoke_not_final_panorama_quality_acceptance'),
    proofClaims: z.array(z.string().min(1)).min(5),
    proofStatus: z.literal('runtime_apply_capable'),
    runtimeProof: z
      .object({
        appServerApply: z.string().min(1),
        appServerDryRun: z.string().min(1),
        commandApply: z.string().min(1),
        commandDryRun: z.string().min(1),
        uiSmokeScenario: z.literal('panorama-private-raw-ui'),
      })
      .strict(),
    screenshotArtifacts: z.array(screenshotArtifactSchema).length(4),
    sourceHashes: z.array(sourceHashSchema).length(3),
    sourceSet: z
      .object({
        localSourceFiles: z.array(z.string().endsWith('.ARW')).length(3),
        localSourceRoot: z.literal('/Users/cgas/Pictures/Capture One/Alaska'),
        publicRepoAllowed: z.literal(false),
      })
      .strict(),
    validationCommands: z
      .array(
        z.enum([
          'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-panorama-alaska-proof RAWENGINE_PRIVATE_RAW_SOURCE="/Users/cgas/Pictures/Capture One/Alaska" bun run prepare:panorama-real-raw-private-root -- --require-assets',
          'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-panorama-alaska-proof bun run run:panorama-real-raw-private-proof',
          'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-panorama-alaska-proof bun run check:panorama-real-raw-private-app-server-proof',
          'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-panorama-alaska-proof bun run check:panorama-private-raw-ui-smoke',
        ]),
      )
      .length(4),
  })
  .passthrough()
  .superRefine((report, context) => {
    const artifactKinds = new Set(report.artifacts.map((artifact) => artifact.kind));
    for (const requiredKind of [
      'source_raw_sequence_private',
      'decode_report_private',
      'alignment_report_private',
      'merge_output_private',
      'preview_after_private',
      'export_after_private',
      'quality_report_private',
      'app_server_runtime_report_private',
    ]) {
      if (!artifactKinds.has(requiredKind)) {
        context.addIssue({ code: 'custom', message: `missing artifact ${requiredKind}`, path: ['artifacts'] });
      }
    }
    if (!report.proofClaims.some((claim) => claim.includes('not final panorama quality acceptance'))) {
      context.addIssue({ code: 'custom', message: 'Panorama proof summary must keep quality acceptance boundary.' });
    }
  });

reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));

console.log('panorama real RAW private proof summary ok');
