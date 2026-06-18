#!/usr/bin/env bun

import { runComputationalPrivateProof } from './lib/computational-private-proof-runner.ts';

await runComputationalPrivateProof({
  featureLabel: 'focus',
  fixtureId: 'validation.computational-merge.focus-plane-transition.v1',
  privateStep: {
    command: [
      'cargo',
      'test',
      '--quiet',
      '--locked',
      '--no-default-features',
      '--features',
      'required-ci,tauri-test',
      'focus_real_raw_proof::private_decode_smoke_generates_focus_real_raw_report_when_enabled',
      '--',
      '--nocapture',
    ],
    cwd: 'src-tauri',
    env: {
      RAWENGINE_RUN_PRIVATE_FOCUS_REAL_RAW_DECODE_PROOF: '1',
    },
    label: 'focus real RAW Rust decode proof',
  },
  proofChecks: [
    ['bun', 'run', 'check:focus-runtime-plan-smoke'],
    ['bun', 'run', 'check:focus-app-server-runtime'],
    ['bun', 'run', 'check:focus-ui-runtime-bridge'],
  ],
  skipLabel: 'focus real RAW private proof',
});
