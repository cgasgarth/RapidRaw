#!/usr/bin/env bun
// @ts-check

import { readBoundedStream, writeBoundedOutput } from './compact-output.ts';

const QUICK_CORE = [
  'check:types',
  'check:script-type-coverage',
  'check:script-type-coverage:self-test',
  'check:script-extension-policy',
  'check:script-extension-policy:self-test',
  'check:validation-test-paths',
  'check:pure-ts-tests',
  'check:pure-ts-coverage',
  'check:unused-deps',
  'check:i18n',
  'check:unsafe-casts',
  'check:release-notes',
  'check:release-benchmark-report',
  'check:keyboard-shortcuts',
  'check:keyboard-shortcut-conflicts',
  'check:edit-graph-history',
  'check:edit-history-replay',
  'check:typed-adjustment-command-envelope',
  'check:basic-tone-command-bridge',
  'check:tone-color-app-server-routes',
  'check:rawengine-app-server-host',
  'check:local-app-server-audit-events',
  'check:tauri-schema-validation',
  'check:tauri-invoke-boundaries',
  'check:tauri-invoke-boundaries:self-test',
  'check:rust-advisory-waivers',
] as const;

const QUICK_ROUTED = [
  'check:film-fixtures',
  'check:film-look-preview-export-parity',
  'check:film-look-measured-fixtures',
  'check:export-recipes',
  'check:export-recipes-ui',
  'check:import-presets',
  'check:library-sessions',
  'check:library-session-ui',
  'check:export-queue',
  'check:smart-albums',
  'check:metadata-templates',
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
  'check:color-pipeline-audit',
  'check:denoise-fixtures',
  'check:denoise-ui-api',
  'check:deblur-fixtures',
  'check:deblur-ringing',
  'check:deblur-cpu-reference',
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
  'check:working-space-contract',
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
  'check:negative-lab-stock-metadata-catalog',
  'check:negative-lab-stock-metadata-coverage',
] as const;

const QUICK_SLOW_PROOF = [
  'check:private-raw-evidence',
  'check:raw-open-edit-export-proof',
  'check:raw-open-edit-export-command-wrapper',
  'check:raw-open-edit-export-private-report-collector',
  'check:raw-open-edit-export-private-proof-acceptance',
  'check:raw-open-edit-export-run-reports',
  'check:deblur-real-raw-quality',
  'check:macos-colorsync-display-proof',
  'check:negative-lab-measured-render-proof',
  'check:negative-lab-real-fixtures',
] as const;

const CHECK_GROUPS = {
  'check:quick': QUICK_CORE,
  'check:quick:all': [...QUICK_CORE, ...QUICK_ROUTED, ...QUICK_SLOW_PROOF],
  'check:quick:core': QUICK_CORE,
  'check:quick:routed': QUICK_ROUTED,
  'check:quick:slow-proof': QUICK_SLOW_PROOF,
} as const;

if (process.argv.includes('--self-test')) {
  validateQuickTiers();
  process.exit(0);
}

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

function validateQuickTiers() {
  const core = CHECK_GROUPS['check:quick:core'];
  const routed = CHECK_GROUPS['check:quick:routed'];
  const slowProof = CHECK_GROUPS['check:quick:slow-proof'];
  const all = CHECK_GROUPS['check:quick:all'];
  const expectedAll = [...core, ...routed, ...slowProof];
  const failures = [];

  if (CHECK_GROUPS['check:quick'] !== core) failures.push('check:quick must point at core tier.');
  if (all.length !== expectedAll.length) failures.push('check:quick:all must include every tier exactly once.');

  const seen = new Set<string>();
  for (const script of all) {
    if (seen.has(script)) failures.push(`duplicate quick-tier script: ${script}`);
    seen.add(script);
  }

  for (const script of expectedAll) {
    if (!seen.has(script)) failures.push(`missing quick-tier script: ${script}`);
  }

  if (core.length === 0 || routed.length === 0 || slowProof.length === 0) {
    failures.push('quick tiers must include core, routed, and slow-proof checks.');
  }

  if (failures.length > 0) {
    console.error('quick tier self-test failed');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`quick tiers ok (core=${core.length}, routed=${routed.length}, slow-proof=${slowProof.length})`);
}
