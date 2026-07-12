#!/usr/bin/env bun

import { access, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const sourceAppPath = resolve('src-tauri/target/release/bundle/macos/RapidRAW.app');
const defaultInstallPath = '/Applications/RapidRAW.app';
const bundleIdentifier = 'io.github.CyberTimon.RapidRAW';
const args = process.argv.slice(2);
const shouldBuild = !args.includes('--no-build');
const shouldInstall = !args.includes('--no-install');
const shouldLaunch = !args.includes('--no-launch');
const shouldUseVerboseBuildLogs = !args.includes('--compact');

const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const installPath = resolve(valueAfter('--app-path') ?? defaultInstallPath);
const scriptStartedAt = performance.now();

const formatDuration = (milliseconds: number): string => {
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds - minutes * 60;
  return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
};

async function run(
  command: string,
  commandArgs: string[],
  label: string,
  allowedExitCodes = [0],
  env: Record<string, string> = {},
): Promise<void> {
  const stepStartedAt = performance.now();
  console.log(`${label} started`);
  console.log(`$ ${[command, ...commandArgs].join(' ')}`);

  const proc = Bun.spawn([command, ...commandArgs], {
    env: { ...Bun.env, ...env },
    stderr: 'inherit',
    stdout: 'inherit',
  });

  const heartbeat = setInterval(() => {
    console.log(`${label} still running (${formatDuration(performance.now() - stepStartedAt)} elapsed)`);
  }, 15_000);

  const exitCode = await proc.exited;
  clearInterval(heartbeat);

  const duration = formatDuration(performance.now() - stepStartedAt);

  if (allowedExitCodes.includes(exitCode)) {
    console.log(`${label} ok (${duration})`);
    return;
  }

  console.error(`${label} failed (${duration}; exit ${exitCode})`);
  process.exit(exitCode);
}

async function assertExists(path: string, label: string): Promise<void> {
  try {
    await access(path);
  } catch {
    console.error(`${label} missing: ${path}`);
    process.exit(1);
  }
}

if (shouldBuild) {
  await run(
    'bun',
    [
      'scripts/ci/run-resource-coordinated.ts',
      '--resource',
      'native-heavy',
      '--label',
      'computer-use-release-build',
      '--',
      'bun',
      'tauri',
      'build',
      ...(shouldUseVerboseBuildLogs ? ['--verbose'] : []),
      '--ci',
      '--bundles',
      'app',
      '--features',
      'required-ci',
    ],
    'computer-use release app build',
    [0],
    shouldUseVerboseBuildLogs ? { CARGO_TERM_VERBOSE: 'true' } : {},
  );
}

await assertExists(sourceAppPath, 'computer-use release app');

if (shouldInstall) {
  await run('pkill', ['-x', 'RapidRAW'], 'computer-use stale app quit', [0, 1]);
  await mkdir(dirname(installPath), { recursive: true });
  await rm(installPath, { force: true, recursive: true });
  await run('ditto', [sourceAppPath, installPath], 'computer-use app install');
  await run(
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    ['-f', installPath],
    'computer-use app registration',
  );
}

if (shouldLaunch) {
  const launchPath = shouldInstall ? installPath : sourceAppPath;
  await run('open', ['-n', launchPath], 'computer-use app launch');
}

console.log(
  `computer-use app ok (${formatDuration(performance.now() - scriptStartedAt)} total; ${bundleIdentifier}; ${
    shouldInstall ? installPath : sourceAppPath
  })`,
);
