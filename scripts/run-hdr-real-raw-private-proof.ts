#!/usr/bin/env bun

import { runComputationalPrivateProof } from './lib/computational-private-proof-runner.ts';
import { getComputationalPrivateProofConfig } from './lib/computational-private-proof-registry.ts';

await runComputationalPrivateProof(getComputationalPrivateProofConfig('hdr'));
