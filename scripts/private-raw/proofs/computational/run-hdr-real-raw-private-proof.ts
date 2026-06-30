#!/usr/bin/env bun

import { getComputationalPrivateProofConfig } from '../../../lib/private-raw/computational-proof-registry.ts';
import { runComputationalPrivateProof } from '../../../lib/private-raw/computational-proof-runner.ts';

await runComputationalPrivateProof(getComputationalPrivateProofConfig('hdr'));
