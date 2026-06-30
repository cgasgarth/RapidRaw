#!/usr/bin/env bun

import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { writeBoundedOutput } from '../../../scripts/lib/compact-output.ts';
import { parseDeblurFixtureManifest } from '../../../src/schemas/deblurFixtureSchemas.ts';

const REPORT_PATH = resolve('src-tauri/target/rawengine-deblur-cpu-reference-report.json');
const REQUIRED_RUST_TOOLCHAIN = '1.95.0';

const resolveCargoArgs = () => {
  const args = ['test', '--manifest-path', 'src-tauri/Cargo.toml', 'deblur_cpu_reference', '--', '--nocapture'];

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

const fixtureManifest = parseDeblurFixtureManifest(
  JSON.parse(await readFile('fixtures/detail/deblur-fixtures.json', 'utf8')),
);
const expectedAcceptedFixtureCount = fixtureManifest.fixtures.filter(
  (fixture) => fixture.acceptancePolicy.action === 'accept',
).length;
const expectedRejectedFixtureCount = fixtureManifest.fixtures.filter(
  (fixture) => fixture.acceptancePolicy.action === 'reject',
).length;

const proc = Bun.spawn(['cargo', ...resolveCargoArgs()], {
  env: {
    ...process.env,
    RAWENGINE_DEBLUR_CPU_REPORT: REPORT_PATH,
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

if (report.issue !== 1180) {
  failures.push('Deblur CPU report must reference issue 1180.');
}

if (report.runtimeStatus !== 'cpu_reference_only') {
  failures.push('Deblur CPU report must stay cpu_reference_only.');
}

if (report.stage !== 'scene_linear_post_denoise') {
  failures.push('Deblur CPU report must declare scene-linear post-denoise stage.');
}

if (report.algorithm !== 'constrained_van_cittert_gaussian_luma') {
  failures.push('Deblur CPU report must name the constrained Van Cittert Gaussian luma algorithm.');
}

const fixtures = Array.isArray(report.fixtures) ? report.fixtures : [];
if (fixtures.length !== expectedAcceptedFixtureCount) {
  failures.push(`Deblur CPU report must include ${expectedAcceptedFixtureCount} accepted synthetic fixture artifacts.`);
}

for (const fixture of fixtures) {
  if (fixture.runtimeStatus !== 'cpu_reference_only') {
    failures.push(`${fixture.fixtureId}: expected cpu_reference_only runtime status.`);
  }
  if (fixture.applyStatus !== 'applied') {
    failures.push(`${fixture.fixtureId}: expected applied CPU status.`);
  }
  if (fixture.stage !== 'scene_linear_post_denoise') {
    failures.push(`${fixture.fixtureId}: expected scene_linear_post_denoise stage.`);
  }
  for (const limitation of ['preview_export_parity', 'real_raw_quality', 'gpu_parity', 'ui_api_e2e']) {
    if (!fixture.doesNotProve?.includes(limitation)) {
      failures.push(`${fixture.fixtureId}: missing ${limitation} limitation.`);
    }
  }
  for (const [metricName, metricValue] of Object.entries(fixture.metrics ?? {})) {
    if (!Number.isFinite(metricValue)) {
      failures.push(`${fixture.fixtureId}: ${metricName} must be finite.`);
    }
  }
}

const skippedFixtures = Array.isArray(report.skippedFixtures) ? report.skippedFixtures : [];
if (skippedFixtures.length !== expectedRejectedFixtureCount) {
  failures.push(`Deblur CPU report must include ${expectedRejectedFixtureCount} skipped synthetic fixture artifacts.`);
}

for (const fixture of skippedFixtures) {
  if (fixture.runtimeStatus !== 'cpu_reference_only') {
    failures.push(`${fixture.fixtureId}: expected cpu_reference_only runtime status.`);
  }
  if (fixture.applyStatus !== 'skipped') {
    failures.push(`${fixture.fixtureId}: expected skipped CPU status.`);
  }
  if (!['unsupported_psf', 'noise_too_high', 'saturated_edge_risk'].includes(fixture.skipReason)) {
    failures.push(`${fixture.fixtureId}: unexpected skip reason ${fixture.skipReason}.`);
  }
}

if (failures.length > 0) {
  console.error('Deblur CPU reference validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${fixtures.length} CPU reference deblur fixtures.`);
