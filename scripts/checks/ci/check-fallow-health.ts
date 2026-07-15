#!/usr/bin/env bun

import { evaluateFallowHealthOutput } from '../../lib/ci/fallow-health-gate';

const command = ['bunx', 'fallow', 'health', '--score', '--format', 'json', '--quiet'];
const result = Bun.spawnSync(command, {
  env: { ...process.env, FALLOW_UPDATE_CHECK: 'off' },
  stderr: 'pipe',
  stdout: 'pipe',
});
const stdout = result.stdout.toString();
const stderr = result.stderr.toString().trim();

if (result.exitCode !== 0) {
  console.error(`fallow health command failed (exit=${result.exitCode})${stderr ? `: ${stderr}` : ''}`);
  process.exit(1);
}

try {
  const gate = evaluateFallowHealthOutput(stdout, process.env.FALLOW_HEALTH_MIN_SCORE);
  const write = gate.exitCode === 0 ? console.log : console.error;
  write(gate.message);
  process.exit(gate.exitCode);
} catch (error) {
  console.error(`fallow health report invalid: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
