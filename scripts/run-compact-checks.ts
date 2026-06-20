#!/usr/bin/env bun
// @ts-check

import { readBoundedStream, writeBoundedOutput } from './compact-output.ts';

const CHECK_GROUPS = {
  'check:quick': [
    'check:types',
    'check:script-type-coverage',
    'check:script-type-coverage:self-test',
    'check:script-extension-policy',
    'check:script-extension-policy:self-test',
    'check:pure-ts-tests',
    'check:pure-ts-coverage',
    'check:unused-deps',
    'check:i18n',
    'check:unsafe-casts',
    'check:film-fixtures',
    'check:film-look-preview-export-parity',
    'check:film-look-measured-fixtures',
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
    'check:edit-graph-history',
    'check:edit-history-replay',
    'check:basic-tone-command-bridge',
    'check:tone-color-app-server-routes',
    'check:rawengine-app-server-host',
    'check:tauri-schema-validation',
    'check:tauri-invoke-boundaries',
    'check:tauri-invoke-boundaries:self-test',
    'check:rust-advisory-waivers',
    'check:workspace-layouts',
    'check:compare-survey',
    'check:mask-render',
    'check:render-artifacts',
    'check:reference-images',
    'check:output-sharpening',
    'check:chromatic-adaptation',
    'check:white-balance-picker',
    'check:capture-sharpening',
    'check:wavelet-detail',
    'check:private-raw-evidence',
    'check:raw-open-edit-export-proof',
    'check:raw-open-edit-export-command-wrapper',
    'check:raw-open-edit-export-private-report-collector',
    'check:raw-open-edit-export-private-proof-acceptance',
    'check:raw-open-edit-export-run-reports',
    'check:color-pipeline-audit',
    'check:denoise-fixtures',
    'check:denoise-ui-api',
    'check:deblur-fixtures',
    'check:deblur-ringing',
    'check:deblur-cpu-reference',
    'check:deblur-real-raw-quality',
    'check:deblur-ui-api',
    'check:detail-preview-export-parity',
    'check:detail-stage-order',
    'check:detail-artifacts',
    'check:noise-metrics',
    'check:noise-separation',
    'check:deltae-fixtures',
    'check:defringe',
    'check:dust-spot-visualization',
    'check:ai-fallbacks',
    'check:color-abi',
    'check:preview-scopes',
    'check:color-cpu-gpu-parity',
    'check:gamut-mapping',
    'check:black-white-mixer',
    'check:color-balance-rgb',
    'check:channel-mixer',
    'check:levels-runtime',
    'check:color-grading-presets',
    'check:profile-tone',
    'check:camera-profile-lookup',
    'check:colorchecker-fixtures',
    'check:colorchecker-render-gate',
    'check:color-style-presets',
    'check:selective-color-ranges',
    'check:selective-color-falloff',
    'check:skin-tone-uniformity',
    'check:local-contrast-controls',
    'check:selective-color-mask',
    'check:layer-stack',
    'check:layer-blend-runtime',
    'check:layer-multiply-screen-runtime',
    'check:layer-normal-opacity-runtime',
    'check:layer-overlay-soft-light-runtime',
    'check:layer-stack-undo-redo',
    'check:layer-mask-audit',
    'check:layer-adjustments',
    'check:layer-preview-export-parity',
    'check:brush-mask',
    'check:brush-mask-command',
    'check:gradient-mask',
    'check:luminance-range-mask',
    'check:color-range-mask',
    'check:mask-compose',
    'check:mask-compose-command',
    'check:mask-refine',
    'check:mask-refine-controls',
    'check:mask-refine-command-ui',
    'check:mask-overlay',
    'check:mask-copy-paste',
    'check:ai-mask-capabilities',
    'check:ai-people-masks',
    'check:ai-people-picker',
    'check:ai-people-fake-provider',
    'check:ai-people-render',
    'check:ai-people-apply-plan',
    'check:negative-lab-ui-presets',
    'check:negative-lab-frame-health',
    'check:negative-lab-measured-render-proof',
    'check:negative-lab-real-fixtures',
    'check:negative-lab-stock-metadata-catalog',
    'check:negative-lab-stock-metadata-coverage',
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
