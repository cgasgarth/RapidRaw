#!/usr/bin/env bun

import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { readBoundedStream, writeBoundedOutput } from '../../../scripts/lib/compact-output.ts';
import { parseDenoiseWorkflowReport } from '../../../src/schemas/denoiseWorkflowSchemas.ts';

const REPORT_PATH = resolve('src-tauri/target/rawengine-denoise-workflow-report.json');
const ARTIFACT_PATH = resolve('src-tauri/target/rawengine-denoise-workflow-preview.png');
const REQUIRED_RUST_TOOLCHAIN = '1.95.0';

const resolveCargoArgs = () => {
  const args = ['test', '--manifest-path', 'src-tauri/Cargo.toml', 'denoise_render', '--lib', '--', '--nocapture'];

  if (process.env.RAWENGINE_RUST_TOOLCHAIN) return [`+${process.env.RAWENGINE_RUST_TOOLCHAIN}`, ...args];

  const rustup = Bun.spawnSync(['rustup', 'toolchain', 'list'], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (rustup.success && new TextDecoder().decode(rustup.stdout).includes(REQUIRED_RUST_TOOLCHAIN)) {
    return [`+${REQUIRED_RUST_TOOLCHAIN}`, ...args];
  }

  return args;
};

await mkdir(dirname(REPORT_PATH), { recursive: true });

const proc = Bun.spawn(['cargo', ...resolveCargoArgs()], {
  env: {
    ...process.env,
    RAWENGINE_DENOISE_WORKFLOW_PREVIEW_ARTIFACT: ARTIFACT_PATH,
    RAWENGINE_DENOISE_WORKFLOW_REPORT: REPORT_PATH,
  },
  stderr: 'pipe',
  stdout: 'pipe',
});
const stdout = readBoundedStream(proc.stdout);
const stderr = readBoundedStream(proc.stderr);
const exitCode = await proc.exited;
if (exitCode !== 0) {
  writeBoundedOutput('stdout', await stdout);
  writeBoundedOutput('stderr', await stderr);
  process.exit(exitCode);
}

const report = parseDenoiseWorkflowReport(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
const artifact = await stat(report.artifactPath);
if (!artifact.isFile() || artifact.size < 128) {
  console.error(`Denoise workflow artifact is missing or too small: ${report.artifactPath}`);
  process.exit(1);
}
if (report.inputToPreviewMaxDelta <= 0.0001) {
  console.error(`Denoise workflow did not change pixels enough: ${report.inputToPreviewMaxDelta}`);
  process.exit(1);
}

console.log(
  `denoise workflow ok delta=${report.inputToPreviewMaxDelta.toFixed(6)} artifact=${basename(report.artifactPath)}`,
);
