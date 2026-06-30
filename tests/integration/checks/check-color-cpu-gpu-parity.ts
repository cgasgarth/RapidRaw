#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  type ColorParityManifest,
  type ColorParityVec3,
  colorParityCaseSchema,
  colorParityShaderFunctionSchema,
  evaluateColorParityCase,
  parseColorParityManifest,
} from '../../../src/utils/colorCpuGpuParity.ts';

const FIXTURE_PATH = 'fixtures/color/cpu-gpu-parity-fixtures.json';
const REPORT_PATH = 'docs/validation/color-cpu-gpu-parity-2026-06-18.json';
const SHADER_PATH = 'src-tauri/src/shaders/shader.wgsl';
const UPDATE = process.argv.includes('--update');
const GPU_PATH_STATUS = 'explicitly_unavailable_in_headless_ci';
const GPU_READBACK_PROBE_STATUS = 'validation_harness_runtime_smoke_committed';
const CPU_PREVIEW_EXPORT_STATUS = 'synthetic_cpu_preview_export_match';
const GPU_UNAVAILABLE_REASON =
  'CI cannot create a deterministic WGPU readback surface for this gate; shader hashes bind the cases to the GPU path until a render-readback harness lands.';
const GPU_READBACK_PROBE_HASH = 'sha256:be2ed0f28ed5d492dfd4f03c6f6f0ca559819d57f38a474448e57d8da41dc572';
const GPU_READBACK_RUNTIME_PROOF_PATH = 'docs/validation/color-gpu-readback-runtime-smoke-2026-06-20.json';
const OPERATION_SHADER_FUNCTIONS = {
  channel_mixer: 'apply_channel_mixer',
  color_balance_rgb: 'apply_color_balance_rgb',
  legacy_tonemap: 'legacy_tonemap',
  linear_exposure: 'apply_linear_exposure',
  luma_levels: 'apply_luma_levels',
  white_balance: 'apply_white_balance',
} satisfies Record<
  ColorParityManifest['cases'][number]['operation'],
  ColorParityManifest['shaderFunctions'][number]['name']
>;

const colorArtifactSchema = z
  .object({
    hash: z.string().regex(/^sha256:[a-f0-9]{16}$/u),
    output: z.array(z.number()).length(3),
    path: z.enum(['cpu_export', 'cpu_preview']),
  })
  .strict();
const artifactDiffSchema = z
  .object({
    componentDeltas: z.array(z.number().min(0)).length(3),
    maxDelta: z.number().min(0),
    tolerance: z.number().positive(),
  })
  .strict();
const parityReportCaseSchema = z
  .object({
    cpuExportArtifact: colorArtifactSchema.extend({ path: z.literal('cpu_export') }).strict(),
    cpuMirrorOutput: z.array(z.number()).length(3),
    cpuPreviewArtifact: colorArtifactSchema.extend({ path: z.literal('cpu_preview') }).strict(),
    expectedOutput: z.array(z.number()).length(3),
    id: z.string(),
    operation: z.string(),
    previewExportDiff: artifactDiffSchema,
    previewFixtureDiff: artifactDiffSchema,
  })
  .strict();
const shaderCoverageSchema = z
  .object({
    caseCount: z.number().int().positive(),
    operation: colorParityCaseSchema.shape.operation,
    shaderFunction: colorParityShaderFunctionSchema.shape.name,
    shaderHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();
const parityReportSchema = z
  .object({
    cases: z.array(parityReportCaseSchema).min(1),
    cpuPreviewExportParity: z
      .object({
        maxDelta: z.number().min(0),
        status: z.literal(CPU_PREVIEW_EXPORT_STATUS),
      })
      .strict(),
    doesNotProve: z.array(z.string().trim().min(1)).nonempty(),
    fixturePath: z.literal(FIXTURE_PATH),
    generatedFromSnapshotDate: z.string(),
    gpuReadback: z
      .object({
        reason: z.literal(GPU_UNAVAILABLE_REASON),
        status: z.literal(GPU_PATH_STATUS),
      })
      .strict(),
    gpuReadbackProbe: z
      .object({
        command: z.literal('run_color_gpu_readback_probe'),
        expectedByteHash: z.literal(GPU_READBACK_PROBE_HASH),
        maxByteDelta: z.literal(0),
        pixelCount: z.literal(4),
        readbackBytes: z.literal(16),
        runtimeProofPath: z.literal(GPU_READBACK_RUNTIME_PROOF_PATH),
        status: z.literal(GPU_READBACK_PROBE_STATUS),
        textureFormat: z.literal('rgba8unorm'),
        validationMode: z.literal('wgpu_copy_texture_to_buffer_readback_probe'),
      })
      .strict(),
    issue: z.literal(2326),
    schemaVersion: z.literal(2),
    shaderCoverage: z.array(shaderCoverageSchema).length(6),
    shaderPath: z.literal(SHADER_PATH),
    shaderFunctions: z.array(z.object({ name: z.string(), sha256: z.string() }).strict()).min(1),
    validationMode: z.literal('cpu_preview_export_parity_with_wgsl_hash_and_explicit_gpu_unavailable_state'),
  })
  .strict();
const gpuReadbackRuntimeProofSchema = z
  .object({
    byteHash: z.literal(GPU_READBACK_PROBE_HASH),
    issue: z.literal(2326),
    maxByteDelta: z.literal(0),
    pixelCount: z.literal(4),
    proofStatus: z.literal('runtime_apply_capable'),
    readbackBytes: z.literal(16),
    runtimeStatus: z.literal('validation_harness_gpu_texture_readback_probe'),
    textureFormat: z.literal('rgba8unorm'),
    validationMode: z.literal('wgpu_copy_texture_to_buffer_readback_probe'),
  })
  .passthrough();

const extractFunction = (source: string, functionName: string): string => {
  const start = source.indexOf(`fn ${functionName}(`);
  if (start < 0) throw new Error(`Missing WGSL function: ${functionName}`);

  const openBrace = source.indexOf('{', start);
  if (openBrace < 0) throw new Error(`Missing WGSL function body: ${functionName}`);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1).trim();
  }

  throw new Error(`Unterminated WGSL function body: ${functionName}`);
};

const hashFunction = (source: string, functionName: string): string =>
  `sha256:${createHash('sha256').update(extractFunction(source, functionName)).digest('hex')}`;
const hashArtifact = (testCase: ColorParityManifest['cases'][number], output: ColorParityVec3): string =>
  `sha256:${createHash('sha256')
    .update(JSON.stringify({ id: testCase.id, operation: testCase.operation, output }))
    .digest('hex')
    .slice(0, 16)}`;
const roundMetric = (value: number) => Number(value.toFixed(12));

function buildReport(manifest: ColorParityManifest) {
  const cases = manifest.cases.map((testCase) => {
    const cpuPreviewArtifact = runCpuPreviewPath(testCase);
    const cpuExportArtifact = runCpuExportPath(testCase);
    return {
      cpuExportArtifact,
      cpuMirrorOutput: cpuPreviewArtifact.output,
      cpuPreviewArtifact,
      expectedOutput: testCase.expectedOutput,
      id: testCase.id,
      operation: testCase.operation,
      previewExportDiff: buildArtifactDiff(cpuPreviewArtifact.output, cpuExportArtifact.output, testCase.tolerance),
      previewFixtureDiff: buildArtifactDiff(cpuPreviewArtifact.output, testCase.expectedOutput, testCase.tolerance),
    };
  });
  const maxPreviewExportDelta = Math.max(...cases.map((testCase) => testCase.previewExportDiff.maxDelta));
  const shaderHashByName = new Map(manifest.shaderFunctions.map((entry) => [entry.name, entry.sha256] as const));
  const shaderCoverage = Object.entries(OPERATION_SHADER_FUNCTIONS).map(([operation, shaderFunction]) =>
    shaderCoverageSchema.parse({
      caseCount: cases.filter((testCase) => testCase.operation === operation).length,
      operation,
      shaderFunction,
      shaderHash: shaderHashByName.get(shaderFunction),
    }),
  );

  return parityReportSchema.parse({
    cases,
    cpuPreviewExportParity: {
      maxDelta: maxPreviewExportDelta,
      status: CPU_PREVIEW_EXPORT_STATUS,
    },
    doesNotProve: [
      'real_gpu_pixel_readback',
      'full_preview_pipeline_parity',
      'full_export_pipeline_parity',
      'raw_file_color_management_parity',
      'full_gpu_shader_preview_export_parity',
    ],
    fixturePath: FIXTURE_PATH,
    generatedFromSnapshotDate: manifest.snapshotDate,
    gpuReadback: {
      reason: GPU_UNAVAILABLE_REASON,
      status: GPU_PATH_STATUS,
    },
    gpuReadbackProbe: {
      command: 'run_color_gpu_readback_probe',
      expectedByteHash: GPU_READBACK_PROBE_HASH,
      maxByteDelta: 0,
      pixelCount: 4,
      readbackBytes: 16,
      runtimeProofPath: GPU_READBACK_RUNTIME_PROOF_PATH,
      status: GPU_READBACK_PROBE_STATUS,
      textureFormat: 'rgba8unorm',
      validationMode: 'wgpu_copy_texture_to_buffer_readback_probe',
    },
    issue: 2326,
    schemaVersion: 2,
    shaderCoverage,
    shaderPath: SHADER_PATH,
    shaderFunctions: manifest.shaderFunctions,
    validationMode: 'cpu_preview_export_parity_with_wgsl_hash_and_explicit_gpu_unavailable_state',
  });
}

function buildArtifactDiff(actualOutput: ColorParityVec3, expectedOutput: ColorParityVec3, tolerance: number) {
  const componentDeltas = actualOutput.map((actual, index) => roundMetric(Math.abs(actual - expectedOutput[index])));
  return {
    componentDeltas,
    maxDelta: roundMetric(Math.max(...componentDeltas)),
    tolerance,
  };
}

function runCpuPreviewPath(testCase: ColorParityManifest['cases'][number]) {
  const output = evaluateColorParityCase(testCase);
  return colorArtifactSchema.parse({
    hash: hashArtifact(testCase, output),
    output,
    path: 'cpu_preview',
  });
}

function runCpuExportPath(testCase: ColorParityManifest['cases'][number]) {
  const serializedCase: unknown = JSON.parse(JSON.stringify(testCase));
  const exportCase = colorParityCaseSchema.parse(serializedCase);
  const output = evaluateColorParityCase(exportCase);
  return colorArtifactSchema.parse({
    hash: hashArtifact(testCase, output),
    output,
    path: 'cpu_export',
  });
}

const fixturePath = resolve(FIXTURE_PATH);
const shaderSource = await readFile(SHADER_PATH, 'utf8');
const manifest = parseColorParityManifest(JSON.parse(await readFile(fixturePath, 'utf8')));
const gpuReadbackRuntimeProof = gpuReadbackRuntimeProofSchema.parse(
  JSON.parse(await readFile(GPU_READBACK_RUNTIME_PROOF_PATH, 'utf8')),
);

let nextManifest = manifest;
if (UPDATE) {
  nextManifest = {
    ...manifest,
    cases: manifest.cases.map((testCase) => ({ ...testCase, expectedOutput: evaluateColorParityCase(testCase) })),
    shaderFunctions: manifest.shaderFunctions.map((entry) => ({
      ...entry,
      sha256: hashFunction(shaderSource, entry.name),
    })),
  };
  await writeFile(fixturePath, `${JSON.stringify(nextManifest, null, 2)}\n`);
}

const failures = [];

for (const entry of nextManifest.shaderFunctions) {
  const actualHash = hashFunction(shaderSource, entry.name);
  if (actualHash !== entry.sha256) {
    failures.push(`${entry.name}: expected ${entry.sha256}, got ${actualHash}`);
  }
}
if (gpuReadbackRuntimeProof.byteHash !== GPU_READBACK_PROBE_HASH) {
  failures.push(`${GPU_READBACK_RUNTIME_PROOF_PATH}: byte hash must match the parity report probe hash.`);
}

for (const testCase of nextManifest.cases) {
  const actualOutput = evaluateColorParityCase(testCase);
  for (const [index, actual] of actualOutput.entries()) {
    const expected = testCase.expectedOutput[index];
    const delta = Math.abs(actual - expected);
    if (delta > testCase.tolerance) {
      failures.push(
        `${testCase.id}[${index}]: expected ${expected}, got ${actual}; delta ${delta} exceeds ${testCase.tolerance}`,
      );
    }
  }
}

const report = buildReport(nextManifest);
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = parityReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    failures.push(`${REPORT_PATH} is stale; run bun run check:color-preview-export-parity --update`);
  }
}

if (failures.length > 0) {
  console.error('Color preview/export parity fixture check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${nextManifest.cases.length} color preview/export parity fixture cases.`);
