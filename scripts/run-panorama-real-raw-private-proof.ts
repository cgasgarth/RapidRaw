#!/usr/bin/env bun

import { runComputationalPrivateProof } from './lib/computational-private-proof-runner.ts';

await runComputationalPrivateProof({
  featureLabel: 'panorama',
  fixtureId: 'validation.computational-merge.panorama-overlap.v1',
  privateStep: {
    command: [
      'cargo',
      'test',
      '--quiet',
      '--locked',
      '--no-default-features',
      '--features',
      'required-ci,tauri-test',
      'panorama_real_raw_proof::private_preview_export_smoke_generates_panorama_real_raw_report_when_enabled',
      '--',
      '--nocapture',
    ],
    cwd: 'src-tauri',
    env: {
      RAWENGINE_RUN_PRIVATE_PANORAMA_REAL_RAW_PREVIEW_EXPORT_PROOF: '1',
    },
    label: 'panorama real RAW Rust preview/export proof',
  },
  proofChecks: [
    ['bun', 'run', 'check:panorama-runtime-plan-smoke'],
    ['bun', 'run', 'check:panorama-app-server-runtime'],
    ['bun', 'run', 'check:panorama-ui-runtime-bridge'],
  ],
  postPrivateChecks: [
    ['bun', 'run', 'check:panorama-real-raw-private-app-server-proof'],
    ['bun', 'run', 'check:panorama-private-raw-ui-smoke'],
  ],
  skipLabel: 'panorama real RAW private proof',
});
