#!/usr/bin/env bun

import { runComputationalPrivateProof } from './lib/computational-private-proof-runner.ts';

await runComputationalPrivateProof({
  featureLabel: 'SR',
  privateStep: {
    command: [
      'bun',
      'scripts/prepare-sr-real-raw-private-root.ts',
      ...(process.argv.includes('--require-assets') ? ['--require-assets'] : []),
    ],
    label: 'SR real RAW private root prep',
  },
  proofChecks: [
    ['bun', 'run', 'check:sr-runtime-plan-smoke'],
    ['bun', 'run', 'check:sr-app-server-runtime'],
    ['bun', 'run', 'check:sr-ui-runtime-bridge'],
  ],
  skipLabel: 'SR real RAW private proof',
});
