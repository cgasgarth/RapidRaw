#!/usr/bin/env bun

import { runComputationalPrivateProof } from './lib/computational-private-proof-runner.ts';

await runComputationalPrivateProof({
  featureLabel: 'focus',
  privateStep: {
    command: [
      'bun',
      'scripts/prepare-focus-real-raw-private-root.ts',
      ...(process.argv.includes('--require-assets') ? ['--require-assets'] : []),
    ],
    label: 'focus real RAW private root prep',
  },
  proofChecks: [
    ['bun', 'run', 'check:focus-runtime-plan-smoke'],
    ['bun', 'run', 'check:focus-app-server-runtime'],
    ['bun', 'run', 'check:focus-ui-runtime-bridge'],
  ],
  skipLabel: 'focus real RAW private proof',
});
