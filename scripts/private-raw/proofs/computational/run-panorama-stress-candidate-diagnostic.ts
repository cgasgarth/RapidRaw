#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

const argsSchema = z
  .object({
    privateRoot: z.string().trim().min(1),
    requireAssets: z.boolean(),
  })
  .strict();

const args = argsSchema.parse({
  privateRoot: process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? '/tmp/rawengine-private-root',
  requireAssets: process.argv.includes('--require-assets'),
});

const requiredSources = [
  'private-fixtures/panorama/stress-pixls-ir-v1/frame-01.arw',
  'private-fixtures/panorama/stress-pixls-ir-v1/frame-02.arw',
  'private-fixtures/panorama/stress-pixls-ir-v1/frame-03.arw',
  'private-fixtures/panorama/stress-pixls-ir-v1/frame-04.arw',
];

const missingSources = requiredSources.filter((sourcePath) => !existsSync(join(args.privateRoot, sourcePath)));
if (missingSources.length > 0) {
  if (args.requireAssets) {
    console.error(`panorama stress diagnostic missing ${missingSources.length} source(s)`);
    console.error(missingSources.slice(0, 4).join('\n'));
    process.exit(1);
  }
  console.log('panorama stress diagnostic skipped (missing private ARWs)');
  process.exit(0);
}

const result = spawnSync(
  'cargo',
  [
    'test',
    '--quiet',
    '--locked',
    '--no-default-features',
    '--features',
    'required-ci,tauri-test',
    'panorama_real_raw_proof::private_stress_candidate_diagnostic_generates_panorama_report_when_enabled',
    '--',
    '--nocapture',
  ],
  {
    cwd: 'src-tauri',
    env: {
      ...process.env,
      RAWENGINE_RUN_PRIVATE_PANORAMA_STRESS_CANDIDATE_DIAGNOSTIC: '1',
    },
    stdio: 'pipe',
  },
);

if (result.status !== 0) {
  console.error('panorama stress diagnostic failed');
  const stderr = result.stderr.toString().trim();
  const stdout = result.stdout.toString().trim();
  if (stderr) console.error(stderr.split('\n').slice(-24).join('\n'));
  if (stdout) console.error(stdout.split('\n').slice(-24).join('\n'));
  process.exit(result.status ?? 1);
}

console.log('panorama stress diagnostic ok');
