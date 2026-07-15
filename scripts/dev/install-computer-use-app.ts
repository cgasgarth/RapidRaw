#!/usr/bin/env bun

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  type CommandRequest,
  type CommandResult,
  cleanupRepositoryAppBundles,
  discoverRepositoryAppBundles,
  findStaleRepositoryRegistrationPaths,
  installCanonicalComputerUseApp,
  parseComputerUseInstallOptions,
  parseGitWorktreePaths,
  parseLaunchServicesRegistrations,
  pathExists,
  RAPIDRAW_BUNDLE_IDENTIFIER,
  unregisterMissingRepositoryBundles,
} from './computer-use-app-install';

const launchServicesRegister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

const scriptStartedAt = performance.now();
const options = parseComputerUseInstallOptions(process.argv.slice(2));

const formatDuration = (milliseconds: number): string => {
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${(seconds - minutes * 60).toFixed(1)}s`;
};

const formatCommand = (request: CommandRequest): string =>
  [request.command, ...request.args].map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ');

const runCommand = async (request: CommandRequest): Promise<CommandResult> => {
  const stepStartedAt = performance.now();
  const process = Bun.spawn([request.command, ...request.args], { stderr: 'pipe', stdout: 'pipe' });
  const heartbeat = setInterval(() => {
    console.log(`${request.label} still running (${formatDuration(performance.now() - stepStartedAt)})`);
  }, 15_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  clearInterval(heartbeat);
  if ((request.allowedExitCodes ?? [0]).includes(exitCode)) return { exitCode, stderr, stdout };
  const excerpt = `${stdout}\n${stderr}`.trim().split('\n').slice(-40).join('\n');
  throw new Error(`${request.label} failed (exit ${exitCode}): ${formatCommand(request)}\n${excerpt}`);
};

const runBuild = async (repositoryRoot: string): Promise<void> => {
  const args = [
    'scripts/ci/run-resource-coordinated.ts',
    '--resource',
    'native-heavy',
    '--label',
    'computer-use-release-build',
    '--',
    'bun',
    'tauri',
    'build',
    ...(options.verboseBuildLogs ? ['--verbose'] : []),
    '--ci',
    '--bundles',
    'app',
    '--features',
    'required-ci',
  ];
  const startedAt = performance.now();
  console.log('computer-use release app build started');
  const process = Bun.spawn(['bun', ...args], {
    cwd: repositoryRoot,
    env: {
      ...Bun.env,
      ...(options.verboseBuildLogs ? { CARGO_TERM_VERBOSE: 'true' } : {}),
    },
    stderr: 'inherit',
    stdout: 'inherit',
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`computer-use release app build failed (exit ${exitCode}).`);
  console.log(`computer-use release app build ok (${formatDuration(performance.now() - startedAt)})`);
};

const readBundleIdentifier = async (bundlePath: string): Promise<string> => {
  const result = await runCommand({
    args: ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', `${bundlePath}/Contents/Info.plist`],
    command: 'plutil',
    label: `read bundle identifier ${bundlePath}`,
  });
  return result.stdout.trim();
};

const repositoryRoot = (
  await runCommand({ args: ['rev-parse', '--show-toplevel'], command: 'git', label: 'resolve repository root' })
).stdout.trim();
const releaseAppPath = resolve(repositoryRoot, 'src-tauri/target/release/bundle/macos/RapidRAW.app');

if (options.shouldBuild) await runBuild(repositoryRoot);

const sourceAppPath = (await pathExists(releaseAppPath)) ? releaseAppPath : options.installPath;
if (!(await pathExists(sourceAppPath))) {
  throw new Error(`computer-use source app missing: ${releaseAppPath}`);
}

let removedRepositoryBundles = 0;
let removedStaleRegistrations = 0;
if (options.shouldInstall) {
  await installCanonicalComputerUseApp({
    installPath: options.installPath,
    readBundleIdentifier,
    run: runCommand,
    sourcePath: sourceAppPath,
    transactionId: randomUUID(),
  });
  const worktreeResult = await runCommand({
    args: ['worktree', 'list', '--porcelain', '-z'],
    command: 'git',
    label: 'discover repository worktrees',
  });
  const worktreePaths = parseGitWorktreePaths(worktreeResult.stdout);
  const repositoryBundles = await discoverRepositoryAppBundles(worktreePaths);
  const launchServicesDump = await runCommand({
    args: ['-dump'],
    command: launchServicesRegister,
    label: 'inspect stale RapidRAW registrations',
  });
  const mainWorktreePath = worktreePaths[0];
  if (mainWorktreePath === undefined) throw new Error('git worktree discovery returned no main worktree.');
  const staleRegistrationPaths = findStaleRepositoryRegistrationPaths({
    canonicalPath: options.installPath,
    mainWorktreePath,
    registrations: parseLaunchServicesRegistrations(launchServicesDump.stdout),
    worktreePaths,
  });
  const existingStaleBundles: string[] = [];
  for (const path of staleRegistrationPaths) {
    if (await pathExists(path)) existingStaleBundles.push(path);
  }
  const missingStaleRegistrations = staleRegistrationPaths.filter((path) => !existingStaleBundles.includes(path));
  const cleanup = await cleanupRepositoryAppBundles({
    bundlePaths: [...repositoryBundles, ...existingStaleBundles],
    keepPaths: [options.installPath],
    readBundleIdentifier,
    run: runCommand,
  });
  removedRepositoryBundles = cleanup.removed.length;
  if (cleanup.skippedBundleIdentifier.length > 0) {
    console.log(`computer-use cleanup skipped ${cleanup.skippedBundleIdentifier.length} non-RapidRAW bundle(s)`);
  }
  removedStaleRegistrations = (
    await unregisterMissingRepositoryBundles({ paths: missingStaleRegistrations, run: runCommand })
  ).length;
}

if (options.shouldLaunch) {
  const launchPath = options.shouldInstall ? options.installPath : sourceAppPath;
  await runCommand({ args: ['-n', launchPath], command: 'open', label: 'launch computer-use app' });
}

console.log(
  `computer-use app ok (${formatDuration(performance.now() - scriptStartedAt)}; ${RAPIDRAW_BUNDLE_IDENTIFIER}; ${
    options.shouldInstall ? options.installPath : sourceAppPath
  }; repository bundles removed=${removedRepositoryBundles}; stale registrations removed=${removedStaleRegistrations})`,
);
