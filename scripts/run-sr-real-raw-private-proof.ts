#!/usr/bin/env bun

import { runComputationalPrivateProof } from './lib/computational-private-proof-runner.ts';

await runComputationalPrivateProof({
  featureLabel: 'SR',
  fixtureId: 'validation.computational-merge.super-resolution-subpixel.v1',
  privateStep: {
    command: [
      'cargo',
      'test',
      '--quiet',
      '--locked',
      '--no-default-features',
      '--features',
      'required-ci,tauri-test',
      'sr_real_raw_proof::private_reconstruction_artifact_smoke_generates_sr_real_raw_report_when_enabled',
      '--',
      '--nocapture',
    ],
    cwd: 'src-tauri',
    env: {
      RAWENGINE_RUN_PRIVATE_SR_REAL_RAW_ARTIFACT_PROOF: '1',
    },
    label: 'SR real RAW Rust artifact proof',
  },
  proofChecks: [
    ['bun', 'run', 'check:sr-runtime-plan-smoke'],
    ['bun', 'run', 'check:sr-app-server-runtime'],
    ['bun', 'run', 'check:sr-ui-runtime-bridge'],
  ],
  postPrivateChecks: [
    ['bun', 'run', 'check:sr-real-raw-private-app-server-proof'],
    ['bun', 'run', 'check:sr-private-raw-ui-smoke'],
  ],
  skipLabel: 'SR real RAW private proof',
});
