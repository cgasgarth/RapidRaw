#!/usr/bin/env bun

import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { parseDenoiseFixtureManifest } from '../../../src/schemas/denoiseFixtureSchemas.ts';
import { writeBoundedOutput } from '../../../scripts/compact-output.ts';

const REPORT_PATH = resolve('src-tauri/target/rawengine-denoise-cpu-reference-report.json');
const REQUIRED_RUST_TOOLCHAIN = '1.95.0';

const resolveCargoArgs = () => {
  const args = ['test', '--manifest-path', 'src-tauri/Cargo.toml', 'denoise_cpu_reference', '--', '--nocapture'];

  if (process.env.RAWENGINE_RUST_TOOLCHAIN) {
    return [`+${process.env.RAWENGINE_RUST_TOOLCHAIN}`, ...args];
  }

  const rustup = Bun.spawnSync(['rustup', 'toolchain', 'list'], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (rustup.success) {
    const toolchains = new TextDecoder().decode(rustup.stdout);
    if (toolchains.includes(REQUIRED_RUST_TOOLCHAIN)) {
      return [`+${REQUIRED_RUST_TOOLCHAIN}`, ...args];
    }
  }

  return args;
};

await mkdir(dirname(REPORT_PATH), { recursive: true });
await rm(REPORT_PATH, { force: true });

const fixtureManifest = parseDenoiseFixtureManifest(
  JSON.parse(await readFile('fixtures/detail/denoise-fixtures.json', 'utf8')),
);
const expectedSyntheticFixtureCount = fixtureManifest.fixtures.filter(
  (fixture) => fixture.sourceKind === 'synthetic_public',
).length;

const proc = Bun.spawn(['cargo', ...resolveCargoArgs()], {
  env: {
    ...process.env,
    RAWENGINE_DENOISE_CPU_REPORT: REPORT_PATH,
  },
  stderr: 'pipe',
  stdout: 'pipe',
});
const stdout = new Response(proc.stdout).text();
const stderr = new Response(proc.stderr).text();

const exitCode = await proc.exited;
if (exitCode !== 0) {
  writeBoundedOutput('stdout', await stdout);
  writeBoundedOutput('stderr', await stderr);
  process.exit(exitCode);
}

const report = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
const failures = [];

if (report.issue !== 1172) {
  failures.push('Denoise CPU report must reference issue 1172.');
}

if (report.runtimeStatus !== 'cpu_reference_only') {
  failures.push('Denoise CPU report must stay cpu_reference_only.');
}

if (report.stage !== 'scene_linear_post_demosaic') {
  failures.push('Denoise CPU report must declare scene-linear post-demosaic stage.');
}

const fixtures = Array.isArray(report.fixtures) ? report.fixtures : [];
if (fixtures.length !== expectedSyntheticFixtureCount) {
  failures.push(`Denoise CPU report must include ${expectedSyntheticFixtureCount} synthetic fixture artifacts.`);
}

for (const fixture of fixtures) {
  if (fixture.runtimeStatus !== 'cpu_reference_only') {
    failures.push(`${fixture.fixtureId}: expected cpu_reference_only runtime status.`);
  }
  for (const limitation of ['preview_export_parity', 'real_raw_quality', 'gpu_parity', 'ui_api_e2e']) {
    if (!fixture.doesNotProve?.includes(limitation)) {
      failures.push(`${fixture.fixtureId}: missing ${limitation} limitation.`);
    }
  }
  for (const artifactKey of ['cleanReference', 'noisyInput', 'denoisedOutput']) {
    if (typeof fixture.artifacts?.[artifactKey] !== 'string') {
      failures.push(`${fixture.fixtureId}: missing ${artifactKey} artifact pointer.`);
    }
  }
  for (const [metricName, metricValue] of Object.entries(fixture.metrics ?? {})) {
    if (!Number.isFinite(metricValue)) {
      failures.push(`${fixture.fixtureId}: ${metricName} must be finite.`);
    }
  }
}

if (failures.length > 0) {
  console.error('Denoise CPU reference validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${fixtures.length} CPU reference denoise fixtures.`);
