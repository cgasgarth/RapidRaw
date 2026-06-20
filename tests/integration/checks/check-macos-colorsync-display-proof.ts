#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';

const PROOF_PATH = 'docs/validation/macos-colorsync-display-proof-2026-06-20.json';
const RAW_PROOF_REQUEST_PATH = 'fixtures/validation/raw-open-edit-export-proof-request.json';
const DISPLAY_PROFILE_DIR = '/Library/ColorSync/Profiles/Displays';

const rawProofRequestSchema = z.looseObject({
  editCommand: z.looseObject({
    colorPipeline: z.looseObject({
      renderTarget: z
        .object({
          bitDepth: z.number().int(),
          embedIcc: z.boolean(),
          intent: z.string().min(1),
          outputProfile: z.string().min(1),
          viewTransform: z.string().min(1),
        })
        .strict(),
      sceneToDisplayTransform: z.string().min(1),
      workingSpace: z.string().min(1),
    }),
    target: z.object({ imagePath: z.string().min(1), kind: z.literal('image') }).strict(),
  }),
  fixtureId: z.string().min(1),
  sourceRelativePath: z.string().min(1),
});

const displaySnapshotSchema = z
  .object({
    candidateDisplayProfileCount: z.number().int().nonnegative(),
    candidateDisplayProfiles: z.array(
      z
        .object({
          fileLabel: z.string().min(1),
          sha256Prefix: z.string().length(16),
          sizeBytes: z.number().int().positive(),
        })
        .strict(),
    ),
    mainDisplay: z
      .object({
        connectionType: z.string().min(1).optional(),
        displayType: z.string().min(1).optional(),
        name: z.string().min(1),
        pixelResolution: z.string().min(1).optional(),
        pixels: z.string().min(1).optional(),
      })
      .strict(),
    source: z.literal('system_profiler SPDisplaysDataType -json + ColorSync display profile directory'),
  })
  .strict();

const proofSchema = z
  .object({
    displaySnapshot: displaySnapshotSchema,
    fixtureId: z.string().min(1),
    generatedAt: z.string().datetime(),
    issue: z.literal(2327),
    outputTransform: z
      .object({
        bitDepth: z.literal(16),
        embedIcc: z.literal(true),
        intent: z.literal('relative_colorimetric'),
        outputProfile: z.literal('display_p3'),
        sceneToDisplayTransform: z.literal('rawengine_agx_v1'),
        viewTransform: z.literal('rawengine_agx_v1'),
        workingSpace: z.literal('acescg_linear_v1'),
      })
      .strict(),
    rawImagePathFromCommand: z.string().min(1),
    runtimeStatus: z.literal('local_macos_colorsync_display_transform_proof'),
    schemaVersion: z.literal(1),
    sourceRelativePath: z.string().min(1),
  })
  .strict();

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function runSystemProfiler(): unknown {
  if (process.platform !== 'darwin') {
    throw new Error('ColorSync proof update requires macOS.');
  }

  const result = Bun.spawnSync(['system_profiler', 'SPDisplaysDataType', '-json'], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error('system_profiler SPDisplaysDataType failed.');
  }

  return JSON.parse(new TextDecoder().decode(result.stdout));
}

function collectDisplayProfiles(displayName: string) {
  if (!existsSync(DISPLAY_PROFILE_DIR)) return [];

  const normalizedDisplayName = displayName.toLowerCase();
  return readdirSync(DISPLAY_PROFILE_DIR)
    .filter((file) => file.toLowerCase().endsWith('.icc'))
    .filter((file) => file.toLowerCase().startsWith(normalizedDisplayName))
    .toSorted()
    .slice(0, 4)
    .map((file) => {
      const path = join(DISPLAY_PROFILE_DIR, file);
      const profileBytes = readFileSync(path);
      return {
        fileLabel: `${basename(file).split('-')[0] ?? 'display'}-sanitized.icc`,
        sha256Prefix: createHash('sha256').update(profileBytes).digest('hex').slice(0, 16),
        sizeBytes: statSync(path).size,
      };
    });
}

function buildDisplaySnapshot(): z.infer<typeof displaySnapshotSchema> {
  const systemProfilerSchema = z
    .object({
      SPDisplaysDataType: z.array(
        z.looseObject({
          spdisplays_ndrvs: z.array(
            z.looseObject({
              _name: z.string().min(1),
              _spdisplays_pixels: z.string().min(1).optional(),
              spdisplays_connection_type: z.string().min(1).optional(),
              spdisplays_display_type: z.string().min(1).optional(),
              spdisplays_main: z.string().min(1).optional(),
              spdisplays_pixelresolution: z.string().min(1).optional(),
            }),
          ),
        }),
      ),
    })
    .strict();
  const profiler = systemProfilerSchema.parse(runSystemProfiler());
  const displays = profiler.SPDisplaysDataType.flatMap((gpu) => gpu.spdisplays_ndrvs);
  const mainDisplay = displays.find((display) => display.spdisplays_main === 'spdisplays_yes') ?? displays[0];
  if (mainDisplay === undefined) throw new Error('No display metadata found.');

  const candidateDisplayProfiles = collectDisplayProfiles(mainDisplay._name);
  return {
    candidateDisplayProfileCount: candidateDisplayProfiles.length,
    candidateDisplayProfiles,
    mainDisplay: {
      connectionType: mainDisplay.spdisplays_connection_type,
      displayType: mainDisplay.spdisplays_display_type,
      name: mainDisplay._name,
      pixelResolution: mainDisplay.spdisplays_pixelresolution,
      pixels: mainDisplay._spdisplays_pixels,
    },
    source: 'system_profiler SPDisplaysDataType -json + ColorSync display profile directory',
  };
}

function buildProof(): z.infer<typeof proofSchema> {
  const request = rawProofRequestSchema.parse(readJson(RAW_PROOF_REQUEST_PATH));
  const renderTarget = request.editCommand.colorPipeline.renderTarget;

  return proofSchema.parse({
    displaySnapshot: buildDisplaySnapshot(),
    fixtureId: request.fixtureId,
    generatedAt: new Date().toISOString(),
    issue: 2327,
    outputTransform: {
      bitDepth: renderTarget.bitDepth,
      embedIcc: renderTarget.embedIcc,
      intent: renderTarget.intent,
      outputProfile: renderTarget.outputProfile,
      sceneToDisplayTransform: request.editCommand.colorPipeline.sceneToDisplayTransform,
      viewTransform: renderTarget.viewTransform,
      workingSpace: request.editCommand.colorPipeline.workingSpace,
    },
    rawImagePathFromCommand: request.editCommand.target.imagePath,
    runtimeStatus: 'local_macos_colorsync_display_transform_proof',
    schemaVersion: 1,
    sourceRelativePath: request.sourceRelativePath,
  });
}

function checkProof() {
  const request = rawProofRequestSchema.parse(readJson(RAW_PROOF_REQUEST_PATH));
  const proof = proofSchema.parse(readJson(PROOF_PATH));
  const renderTarget = request.editCommand.colorPipeline.renderTarget;
  const failures = [];

  if (proof.fixtureId !== request.fixtureId) failures.push('Proof fixtureId does not match RAW proof request.');
  if (proof.sourceRelativePath !== request.sourceRelativePath)
    failures.push('Proof source path does not match request.');
  if (proof.rawImagePathFromCommand !== request.editCommand.target.imagePath) {
    failures.push('Proof target image path does not match command target.');
  }
  if (proof.outputTransform.outputProfile !== renderTarget.outputProfile) {
    failures.push('Proof output profile does not match command render target.');
  }
  if (proof.outputTransform.viewTransform !== renderTarget.viewTransform) {
    failures.push('Proof view transform does not match command render target.');
  }
  if (proof.outputTransform.sceneToDisplayTransform !== request.editCommand.colorPipeline.sceneToDisplayTransform) {
    failures.push('Proof scene-to-display transform does not match command pipeline.');
  }
  if (proof.displaySnapshot.candidateDisplayProfileCount !== proof.displaySnapshot.candidateDisplayProfiles.length) {
    failures.push('Display profile count does not match display profile entries.');
  }

  if (failures.length > 0) {
    console.error('macOS ColorSync display proof failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log('macOS ColorSync display proof ok (local RAW output transform labels)');
}

if (process.argv.includes('--update')) {
  writeFileSync(PROOF_PATH, `${JSON.stringify(buildProof(), null, 2)}\n`);
  console.log(`macOS ColorSync display proof updated: ${PROOF_PATH}`);
} else {
  checkProof();
}
