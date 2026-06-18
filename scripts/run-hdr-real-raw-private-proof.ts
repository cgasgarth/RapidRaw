#!/usr/bin/env bun

import { runComputationalPrivateProof } from './lib/computational-private-proof-runner.ts';

await runComputationalPrivateProof({
  featureLabel: 'hdr',
  privateStep: {
    command: [
      'cargo',
      'test',
      '--quiet',
      '--locked',
      '--no-default-features',
      '--features',
      'required-ci,tauri-test',
      'hdr_real_raw_proof::private_runtime_smoke_generates_hdr_real_raw_report_when_enabled',
      '--',
      '--nocapture',
    ],
    cwd: 'src-tauri',
    env: {
      RAWENGINE_RUN_PRIVATE_HDR_REAL_RAW_PROOF: '1',
    },
    label: 'hdr real RAW Rust proof',
  },
  proofChecks: [
    ['bun', 'run', 'check:hdr-runtime-plan-smoke'],
    ['bun', 'run', 'check:hdr-app-server-runtime'],
    ['bun', 'run', 'check:hdr-ui-runtime-bridge'],
  ],
  skipLabel: 'hdr real RAW private proof',
});
