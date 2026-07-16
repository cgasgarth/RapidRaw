#!/usr/bin/env bun

export const buildBunCoverageCommand = (targets: readonly string[] = ['tests/pure-ts']): [string, ...string[]] => [
  'bun',
  'test',
  '--no-orphans',
  '--dots',
  '--parallel',
  '--coverage',
  ...targets,
];

export async function runBunCoverage(targets: readonly string[] = ['tests/pure-ts']): Promise<number> {
  const tests = Bun.spawn(buildBunCoverageCommand(targets), {
    env: process.env,
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  });
  const testExitCode = await tests.exited;
  if (testExitCode !== 0) return testExitCode;

  return await Bun.spawn(['bun', 'scripts/ci/check-bun-coverage.ts'], {
    env: process.env,
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  }).exited;
}

if (import.meta.main) process.exit(await runBunCoverage(process.argv.slice(2)));
