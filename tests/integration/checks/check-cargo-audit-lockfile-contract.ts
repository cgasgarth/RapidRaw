#!/usr/bin/env bun

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const reportSchema = z.object({
  lockfile: z.object({ 'dependency-count': z.number().int().nonnegative() }),
  settings: z.object({ ignore: z.array(z.string()) }),
  vulnerabilities: z.object({ count: z.number().int().nonnegative(), found: z.boolean() }),
});

const fixtureRoot = await mkdtemp(join(tmpdir(), 'rapidraw-cargo-audit-'));
const fixtureLockfile = join(fixtureRoot, 'Cargo.lock');

try {
  await writeFile(fixtureLockfile, 'version = 4\n');
  const process = Bun.spawn(['cargo', 'audit', '--file', fixtureLockfile, '--stale', '--json'], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`cargo-audit lockfile contract failed (${exitCode}): ${stderr.trim().slice(-2_000)}`);
  }

  const report = reportSchema.parse(JSON.parse(stdout));
  if (
    report.lockfile['dependency-count'] !== 0 ||
    report.settings.ignore.length !== 0 ||
    report.vulnerabilities.found ||
    report.vulnerabilities.count !== 0
  ) {
    throw new Error(`cargo-audit did not honor the isolated lockfile: ${JSON.stringify(report)}`);
  }

  console.log('cargo-audit lockfile contract ok');
} finally {
  await rm(fixtureRoot, { force: true, recursive: true });
}
