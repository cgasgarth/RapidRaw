#!/usr/bin/env bun

import { getComputationalPrivateProofConfig } from './lib/computational-private-proof-registry.ts';
import { runComputationalPrivateProof } from './lib/computational-private-proof-runner.ts';

await runComputationalPrivateProof(getComputationalPrivateProofConfig('focus'));
