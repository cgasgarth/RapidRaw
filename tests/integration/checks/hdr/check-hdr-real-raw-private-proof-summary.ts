#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/proofs/hdr/hdr-real-raw-private-proof-2026-06-20.json';

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
    localRelativePath: z.string().startsWith('private-fixtures/hdr/bracket-alignment-v1/'),
    path: z.string().startsWith('private-fixtures/hdr/bracket-alignment-v1/'),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const reportSchema = z
  .object({
    $schema: z.literal('https://rawengine.dev/schemas/private-raw-proof-summary-v1.json'),
    artifacts: z.array(privateArtifactSchema).min(8),
    e2eIssue: z.literal(2312),
    featureFamily: z.literal('hdr_merge'),
    fixtureId: z.literal('validation.computational-merge.hdr-bracket-alignment.v1'),
    implementationIssue: z.literal(4655),
    proofClaims: z.array(z.string().min(1)).min(5),
    proofStatus: z.literal('runtime_apply_capable'),
    runtimeProof: z
      .object({
        appServerApply: z.string().min(1),
        appServerDryRun: z.string().min(1),
        commandApply: z.string().min(1),
        commandDryRun: z.string().min(1),
        uiSmokeScenario: z.literal('hdr-private-raw-ui'),
      })
      .strict(),
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
          'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-hdr-alaska-proof RAWENGINE_PRIVATE_RAW_SOURCE="/Users/cgas/Pictures/Capture One/Alaska" bun scripts/private-raw/prepare/prepare-hdr-real-raw-private-root.ts -- --require-assets',
          'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-hdr-alaska-proof bun scripts/private-raw/proofs/computational/run-hdr-real-raw-private-proof.ts --require-assets',
          'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-hdr-alaska-proof bun tests/integration/checks/hdr/check-hdr-real-raw-private-app-server-proof.ts',
          'RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-hdr-alaska-proof bun scripts/proofs/capture-visual-smoke.ts --scenario hdr-private-raw-ui',
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
    if (!report.proofClaims.some((claim) => claim.includes('source RAW hashes'))) {
      context.addIssue({ code: 'custom', message: 'HDR proof summary must claim source RAW hash integrity.' });
    }
    if (!report.proofClaims.some((claim) => claim.includes('stale-state'))) {
      context.addIssue({ code: 'custom', message: 'HDR proof summary must claim stale-state coverage.' });
    }
    if (!report.proofClaims.some((claim) => claim.includes('not final HDR/deghosting quality acceptance'))) {
      context.addIssue({ code: 'custom', message: 'HDR proof summary must keep quality acceptance boundary.' });
    }
  });

reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));

console.log('hdr real RAW private proof summary ok');
