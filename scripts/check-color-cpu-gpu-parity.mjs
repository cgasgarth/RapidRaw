#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const FIXTURE_PATH = 'fixtures/color/cpu-gpu-parity-fixtures.json';
const SHADER_PATH = 'src-tauri/src/shaders/shader.wgsl';
const UPDATE = process.argv.includes('--update');

const OperationSchema = z.enum(['linear_exposure', 'white_balance', 'legacy_tonemap']);

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

const ParityCaseSchema = z
  .object({
    expectedOutput: Vec3Schema,
    id: z.string().regex(/^color\.parity\.[a-z0-9.-]+\.v[0-9]+$/u),
    input: Vec3Schema,
    notes: z.string().trim().min(1),
    operation: OperationSchema,
    parameters: z.record(z.string(), z.number()).default({}),
    tolerance: z.number().positive().max(0.005),
  })
  .strict();

const ShaderFunctionSchema = z
  .object({
    name: z.enum(['apply_linear_exposure', 'apply_white_balance', 'legacy_tonemap']),
    sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();

const ManifestSchema = z
  .object({
    $schema: z.string().url(),
    cases: z.array(ParityCaseSchema).min(1),
    issue: z.literal(95),
    schemaVersion: z.literal(1),
    shaderFunctions: z.array(ShaderFunctionSchema).min(1),
    snapshotDate: z.string().date(),
    validationMode: z.literal('wgsl_contract_cpu_mirror'),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = manifest.cases.map((testCase) => testCase.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Parity case IDs must be unique.', path: ['cases'] });
    }

    const requiredOperations = new Set(OperationSchema.options);
    for (const operation of manifest.cases.map((testCase) => testCase.operation)) {
      requiredOperations.delete(operation);
    }
    if (requiredOperations.size > 0) {
      context.addIssue({
        code: 'custom',
        message: `Missing parity cases for: ${[...requiredOperations].join(', ')}.`,
        path: ['cases'],
      });
    }

    const functionNames = manifest.shaderFunctions.map((entry) => entry.name);
    if (new Set(functionNames).size !== functionNames.length) {
      context.addIssue({
        code: 'custom',
        message: 'Shader function entries must be unique.',
        path: ['shaderFunctions'],
      });
    }
  });

const round = (value) => Number(value.toFixed(8));
const mapVec3 = (values, mapper) => values.map(mapper).map(round);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const applyLinearExposure = (input, parameters) => {
  const exposure = parameters.exposure ?? 0;
  if (exposure === 0) return input.map(round);
  const multiplier = 2 ** exposure;
  return mapVec3(input, (channel) => channel * multiplier);
};

const applyWhiteBalance = (input, parameters) => {
  const temperature = parameters.temperature ?? 0;
  const tint = parameters.tint ?? 0;
  const temperatureMultiplier = [1 + temperature * 0.2, 1 + temperature * 0.05, 1 - temperature * 0.2];
  const tintMultiplier = [1 + tint * 0.25, 1 - tint * 0.25, 1 + tint * 0.25];
  return mapVec3(input, (channel, index) => channel * temperatureMultiplier[index] * tintMultiplier[index]);
};

const applyLegacyTonemap = (input) =>
  mapVec3(input, (channel) => {
    const x = Math.max(channel, 0);
    const numerator = x * (2.51 * x + 0.03);
    const denominator = x * (2.43 * x + 0.59) + 0.14;
    const tonemapped = denominator > 0.00001 ? numerator / denominator : 0;
    return clamp(tonemapped, 0, 1);
  });

const evaluateCase = (testCase) => {
  switch (testCase.operation) {
    case 'linear_exposure':
      return applyLinearExposure(testCase.input, testCase.parameters);
    case 'white_balance':
      return applyWhiteBalance(testCase.input, testCase.parameters);
    case 'legacy_tonemap':
      return applyLegacyTonemap(testCase.input);
  }
};

const extractFunction = (source, functionName) => {
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

const hashFunction = (source, functionName) =>
  `sha256:${createHash('sha256').update(extractFunction(source, functionName)).digest('hex')}`;

const fixturePath = resolve(FIXTURE_PATH);
const shaderSource = await readFile(SHADER_PATH, 'utf8');
const manifest = ManifestSchema.parse(JSON.parse(await readFile(fixturePath, 'utf8')));

let nextManifest = manifest;
if (UPDATE) {
  nextManifest = {
    ...manifest,
    cases: manifest.cases.map((testCase) => ({ ...testCase, expectedOutput: evaluateCase(testCase) })),
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
  const actualOutput = evaluateCase(testCase);
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

if (failures.length > 0) {
  console.error('Color CPU/GPU parity fixture check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${nextManifest.cases.length} color CPU/GPU parity fixture cases.`);
