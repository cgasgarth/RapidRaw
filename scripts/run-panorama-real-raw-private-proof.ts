#!/usr/bin/env bun

import { runComputationalPrivateProof } from './lib/computational-private-proof-runner.ts';

await runComputationalPrivateProof({
  featureLabel: 'panorama',
  privateStep: {
    command: [
      'bun',
      'scripts/prepare-panorama-real-raw-private-root.ts',
      ...(process.argv.includes('--require-assets') ? ['--require-assets'] : []),
    ],
    label: 'panorama real RAW private root prep',
  },
  proofChecks: [
    ['bun', 'run', 'check:panorama-runtime-plan-smoke'],
    ['bun', 'run', 'check:panorama-app-server-runtime'],
    ['bun', 'run', 'check:panorama-ui-runtime-bridge'],
  ],
  skipLabel: 'panorama real RAW private proof',
});
