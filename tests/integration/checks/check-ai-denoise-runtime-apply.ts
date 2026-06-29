#!/usr/bin/env bun

import { applyLocalAiDenoiseAdapter, buildSyntheticAiDenoiseInput } from '../../../src/utils/localAiDenoiseAdapter.ts';

const failures: string[] = [];
const input = buildSyntheticAiDenoiseInput();
const firstRun = applyLocalAiDenoiseAdapter({ input });
const secondRun = applyLocalAiDenoiseAdapter({ input });

if (firstRun.output.contentHash !== secondRun.output.contentHash) {
  failures.push('Local AI denoise adapter output must be deterministic.');
}

if (firstRun.provenance.inputContentHash === firstRun.provenance.outputContentHash) {
  failures.push('Local AI denoise adapter must change output content hash.');
}

if (firstRun.metrics.changedPixelCount !== input.pixels.length) {
  failures.push('Local AI denoise adapter must change every synthetic pixel.');
}

if (firstRun.metrics.inputOutputMaxDelta <= 0.001) {
  failures.push('Local AI denoise adapter max delta is too small to prove apply behavior.');
}

if (firstRun.metrics.edgeEnergyRatio < 0.7) {
  failures.push('Local AI denoise adapter synthetic proof destroyed too much edge energy.');
}

if (!firstRun.warnings.some((warning) => warning.includes('real RAW quality'))) {
  failures.push('Local AI denoise adapter must warn that real RAW quality remains out of scope.');
}

if (!firstRun.doesNotProve.includes('real_raw_quality')) {
  failures.push('Synthetic proof must keep real RAW quality out of scope.');
}

if (!firstRun.doesNotProve.includes('preview_export_parity')) {
  failures.push('Synthetic proof must keep preview/export parity out of scope.');
}

if (failures.length > 0) {
  console.error(`AI denoise runtime apply failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `ai denoise apply ok changed=${firstRun.metrics.changedPixelCount} maxDelta=${firstRun.metrics.inputOutputMaxDelta.toFixed(
    5,
  )} edge=${firstRun.metrics.edgeEnergyRatio.toFixed(3)}`,
);
