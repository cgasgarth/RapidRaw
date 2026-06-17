#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { evaluateColorParityCase, parseColorParityManifest } from '../src/utils/colorCpuGpuParity.ts';

const FIXTURE_PATH = 'fixtures/color/cpu-gpu-parity-fixtures.json';
const SHADER_PATH = 'src-tauri/src/shaders/shader.wgsl';
const UPDATE = process.argv.includes('--update');

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

if (failures.length > 0) {
  console.error('Color CPU/GPU parity fixture check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${nextManifest.cases.length} color CPU/GPU parity fixture cases.`);
