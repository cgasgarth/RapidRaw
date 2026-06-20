#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  evaluateColorParityCase,
  parseColorParityManifest,
  type ColorParityManifest,
  type ColorParityVec3,
} from '../../../src/utils/colorCpuGpuParity.ts';

const FIXTURE_PATH = 'fixtures/color/cpu-gpu-parity-fixtures.json';
const REPORT_PATH = 'docs/validation/color-cpu-gpu-parity-2026-06-18.json';
const SHADER_PATH = 'src-tauri/src/shaders/shader.wgsl';
const UPDATE = process.argv.includes('--update');
const GPU_PATH_STATUS = 'explicitly_unavailable_in_headless_ci';
const GPU_UNAVAILABLE_REASON =
  'CI cannot create a deterministic WGPU readback surface for this gate; shader hashes bind the cases to the GPU path until a render-readback harness lands.';

const parityReportCaseSchema = z
  .object({
    artifactDiff: z.object({
      componentDeltas: z.array(z.number().min(0)).length(3),
      maxDelta: z.number().min(0),
      tolerance: z.number().positive(),
    }),
    cpuMirrorOutput: z.array(z.number()).length(3),
    expectedOutput: z.array(z.number()).length(3),
    gpuPathStatus: z.literal(GPU_PATH_STATUS),
    id: z.string(),
    operation: z.string(),
  })
  .strict();
const parityReportSchema = z
  .object({
    cases: z.array(parityReportCaseSchema).min(1),
    fixturePath: z.literal(FIXTURE_PATH),
    generatedFromSnapshotDate: z.string(),
    gpuUnavailableReason: z.literal(GPU_UNAVAILABLE_REASON),
    issue: z.literal(1933),
    schemaVersion: z.literal(1),
    shaderPath: z.literal(SHADER_PATH),
    shaderFunctions: z.array(z.object({ name: z.string(), sha256: z.string() }).strict()).min(1),
    validationMode: z.literal('cpu_mirror_with_wgsl_hash_and_explicit_gpu_unavailable_state'),
  })
  .strict();

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
const roundMetric = (value: number) => Number(value.toFixed(12));

function buildReport(manifest: ColorParityManifest) {
  return parityReportSchema.parse({
    cases: manifest.cases.map((testCase) => {
      const cpuMirrorOutput = evaluateColorParityCase(testCase);
      return {
        artifactDiff: buildArtifactDiff(cpuMirrorOutput, testCase.expectedOutput, testCase.tolerance),
        cpuMirrorOutput,
        expectedOutput: testCase.expectedOutput,
        gpuPathStatus: GPU_PATH_STATUS,
        id: testCase.id,
        operation: testCase.operation,
      };
    }),
    fixturePath: FIXTURE_PATH,
    generatedFromSnapshotDate: manifest.snapshotDate,
    gpuUnavailableReason: GPU_UNAVAILABLE_REASON,
    issue: 1933,
    schemaVersion: 1,
    shaderPath: SHADER_PATH,
    shaderFunctions: manifest.shaderFunctions,
    validationMode: 'cpu_mirror_with_wgsl_hash_and_explicit_gpu_unavailable_state',
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

const fixturePath = resolve(FIXTURE_PATH);
const shaderSource = await readFile(SHADER_PATH, 'utf8');
const manifest = parseColorParityManifest(JSON.parse(await readFile(fixturePath, 'utf8')));

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
    failures.push(`${REPORT_PATH} is stale; run bun tests/integration/checks/check-color-cpu-gpu-parity.ts --update`);
  }
}

if (failures.length > 0) {
  console.error('Color CPU/GPU parity fixture check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${nextManifest.cases.length} color CPU/GPU parity fixture cases.`);
