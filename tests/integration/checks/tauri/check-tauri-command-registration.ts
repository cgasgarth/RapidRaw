#!/usr/bin/env bun

import { z } from 'zod';

import { Invokes } from '../../../../src/tauri/commands';

const commandNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/u);
const frontendInvokes = z.array(commandNameSchema).parse(Object.values(Invokes));
const result = Bun.spawnSync({
  cmd: [
    'cargo',
    'test',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    'app::command_registration::tests::frontend_registry_matches_typed_invokes',
    '--lib',
    '--quiet',
    '--',
    '--ignored',
    '--exact',
  ],
  env: {
    ...process.env,
    RAWENGINE_FRONTEND_INVOKES: JSON.stringify(frontendInvokes),
  },
  stderr: 'pipe',
  stdout: 'pipe',
});

if (result.exitCode !== 0) {
  const stderr = result.stderr.toString().trim();
  const stdout = result.stdout.toString().trim();
  console.error('Tauri command registration parity failed.');
  if (stdout) console.error(stdout);
  if (stderr) console.error(stderr);
  process.exit(result.exitCode);
}

console.log(`tauri command registration ok (typed invokes=${String(frontendInvokes.length)})`);
