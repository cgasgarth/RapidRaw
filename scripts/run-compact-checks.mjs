#!/usr/bin/env bun

import { readBoundedStream, writeBoundedOutput } from './compact-output.mjs';

const CHECK_GROUPS = {
  'check:quick': [
    'check:types',
    'check:i18n',
    'check:unsafe-casts',
    'check:film-fixtures',
    'check:release-notes',
    'check:release-benchmark-report',
    'check:export-recipes',
    'check:export-recipes-ui',
    'check:import-presets',
    'check:library-sessions',
    'check:library-session-ui',
    'check:export-queue',
    'check:smart-albums',
    'check:metadata-templates',
    'check:keyboard-shortcuts',
    'check:keyboard-shortcut-conflicts',
    'check:workspace-layouts',
    'check:compare-survey',
    'check:mask-render',
    'check:reference-images',
    'check:output-sharpening',
    'check:chromatic-adaptation',
    'check:white-balance-picker',
    'check:capture-sharpening',
    'check:wavelet-detail',
    'check:private-raw-evidence',
    'check:denoise-fixtures',
    'check:denoise-ui-api',
    'check:deblur-fixtures',
    'check:deblur-ringing',
    'check:deblur-cpu-reference',
    'check:deblur-ui-api',
    'check:detail-stage-order',
    'check:detail-artifacts',
    'check:noise-metrics',
    'check:noise-separation',
    'check:deltae-fixtures',
    'check:defringe',
    'check:ai-fallbacks',
    'check:color-abi',
    'check:black-white-mixer',
    'check:camera-profile-lookup',
    'check:colorchecker-fixtures',
    'check:color-style-presets',
    'check:selective-color-ranges',
    'check:selective-color-falloff',
    'check:skin-tone-uniformity',
    'check:local-contrast-controls',
    'check:selective-color-mask',
    'check:layer-stack',
    'check:layer-adjustments',
    'check:brush-mask',
    'check:gradient-mask',
    'check:luminance-range-mask',
    'check:color-range-mask',
    'check:mask-compose',
    'check:mask-refine',
    'check:mask-overlay',
    'check:mask-copy-paste',
    'check:ai-mask-capabilities',
    'check:ai-people-masks',
    'check:ai-people-picker',
    'check:ai-people-fake-provider',
    'check:ai-people-render',
    'check:ai-people-apply-plan',
  ],
};

const args = process.argv.slice(2);
let label = 'checks';
const scripts = [];

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--label') {
    const value = args[index + 1];
    if (!value) {
      console.error('Missing value for --label');
      process.exit(1);
    }

    label = value;
    index += 1;
    continue;
  }

  const group = CHECK_GROUPS[args[index]];
  if (group) {
    label = args[index];
    scripts.push(...group);
    continue;
  }

  scripts.push(args[index]);
}

if (scripts.length === 0) {
  console.error('No package scripts provided.');
  process.exit(1);
}

for (const script of scripts) {
  const proc = Bun.spawn(['bun', 'run', script], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = readBoundedStream(proc.stdout);
  const stderr = readBoundedStream(proc.stderr);
  const exitCode = await proc.exited;

  if (exitCode === 0) {
    continue;
  }

  console.error(`${label} failed at ${script}`);
  console.error(`$ bun run ${script}`);
  const output = await stdout;
  const errorOutput = await stderr;
  writeBoundedOutput('stdout', output);
  writeBoundedOutput('stderr', errorOutput);
  process.exit(exitCode);
}

console.log(`${label} ok (${scripts.length})`);
