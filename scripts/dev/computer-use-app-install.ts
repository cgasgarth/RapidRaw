import { access, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export const RAPIDRAW_BUNDLE_IDENTIFIER = 'io.github.CyberTimon.RapidRAW';
export const RAWENGINE_QA_BUNDLE_IDENTIFIER = 'dev.rawengine.RapidRAW.qa-current';
export const DEFAULT_COMPUTER_USE_APP_PATH = '/Applications/RapidRAW.app';

const REPOSITORY_BUNDLE_IDENTIFIERS = new Set([RAPIDRAW_BUNDLE_IDENTIFIER, RAWENGINE_QA_BUNDLE_IDENTIFIER]);
const TARGET_BUNDLE_DIRECTORIES = [
  'src-tauri/target/debug/bundle/macos',
  'src-tauri/target/release/bundle/macos',
] as const;

export interface CommandRequest {
  allowedExitCodes?: readonly number[];
  args: string[];
  command: string;
  label: string;
}

export interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;
export type BundleIdentifierReader = (bundlePath: string) => Promise<string>;

export interface ComputerUseInstallOptions {
  installPath: string;
  shouldBuild: boolean;
  shouldInstall: boolean;
  shouldLaunch: boolean;
  verboseBuildLogs: boolean;
}

export interface CanonicalInstallResult {
  replacedExistingBundle: boolean;
}

export interface RepositoryCleanupResult {
  removed: string[];
  skippedBundleIdentifier: string[];
}

export interface LaunchServicesRegistration {
  bundleIdentifier: string;
  path: string;
}

export const parseComputerUseInstallOptions = (
  args: readonly string[],
  cwd = process.cwd(),
): ComputerUseInstallOptions => {
  const knownFlags = new Set(['--app-path', '--compact', '--no-build', '--no-install', '--no-launch']);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (!knownFlags.has(argument)) throw new Error(`Unknown computer-use install option: ${argument}`);
    if (argument === '--app-path') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('--app-path requires a path value.');
      index += 1;
    }
  }

  const appPathIndex = args.indexOf('--app-path');
  const appPath = appPathIndex === -1 ? DEFAULT_COMPUTER_USE_APP_PATH : args[appPathIndex + 1];
  if (appPath === undefined) throw new Error('--app-path requires a path value.');

  return {
    installPath: resolve(cwd, appPath),
    shouldBuild: !args.includes('--no-build'),
    shouldInstall: !args.includes('--no-install'),
    shouldLaunch: !args.includes('--no-launch'),
    verboseBuildLogs: !args.includes('--compact'),
  };
};

export const parseGitWorktreePaths = (porcelain: string): string[] =>
  porcelain
    .split('\0')
    .filter((field) => field.startsWith('worktree '))
    .map((field) => resolve(field.slice('worktree '.length)))
    .filter((path, index, paths) => paths.indexOf(path) === index);

export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const discoverRepositoryAppBundles = async (worktreePaths: readonly string[]): Promise<string[]> => {
  const bundles: string[] = [];
  for (const worktreePath of worktreePaths) {
    for (const relativeDirectory of TARGET_BUNDLE_DIRECTORIES) {
      const directory = join(worktreePath, relativeDirectory);
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.endsWith('.app')) bundles.push(resolve(directory, entry.name));
      }
    }
  }
  return bundles.filter((path, index) => bundles.indexOf(path) === index).sort();
};

export const parseLaunchServicesRegistrations = (dump: string): LaunchServicesRegistration[] => {
  const registrations: LaunchServicesRegistration[] = [];
  let path: string | undefined;
  for (const line of dump.split('\n')) {
    const pathMatch = /^path:\s+(.+?)\s+\(0x[0-9a-f]+\)$/i.exec(line);
    if (pathMatch?.[1] !== undefined) path = resolve(pathMatch[1]);
    const identifierMatch = /^identifier:\s+(\S+)\s*$/.exec(line);
    if (path !== undefined && identifierMatch?.[1] !== undefined) {
      registrations.push({ bundleIdentifier: identifierMatch[1], path });
      path = undefined;
    }
  }
  return registrations;
};

const isWorktreeTargetBundle = (path: string, mainWorktreePath: string, worktreePaths: readonly string[]): boolean => {
  const normalizedPath = resolve(path);
  const targetSuffix = /\/src-tauri\/target\/(?:debug|release)\/bundle\/macos\/[^/]+\.app$/;
  if (!targetSuffix.test(normalizedPath)) return false;
  if (worktreePaths.some((worktreePath) => normalizedPath.startsWith(`${resolve(worktreePath)}/`))) return true;
  const main = resolve(mainWorktreePath);
  return normalizedPath.startsWith(`${main}-`);
};

const isRepositoryProofBundle = (path: string): boolean =>
  /^\/private\/tmp\/RapidRAW-[A-Za-z0-9._-]+\.app$/.test(resolve(path));

export const findStaleRepositoryRegistrationPaths = ({
  canonicalPath,
  mainWorktreePath,
  registrations,
  worktreePaths,
}: {
  canonicalPath: string;
  mainWorktreePath: string;
  registrations: readonly LaunchServicesRegistration[];
  worktreePaths: readonly string[];
}): string[] => {
  const canonical = resolve(canonicalPath);
  return registrations
    .filter((registration) => REPOSITORY_BUNDLE_IDENTIFIERS.has(registration.bundleIdentifier))
    .map((registration) => resolve(registration.path))
    .filter((path) => path !== canonical)
    .filter((path) => isWorktreeTargetBundle(path, mainWorktreePath, worktreePaths) || isRepositoryProofBundle(path))
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .sort();
};

const unregisterBundle = async (bundlePath: string, run: CommandRunner): Promise<void> => {
  await run({
    allowedExitCodes: [0, 1],
    args: ['-u', bundlePath],
    command: '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    label: `unregister ${bundlePath}`,
  });
};

const registerBundle = async (bundlePath: string, run: CommandRunner): Promise<void> => {
  await run({
    args: ['-f', bundlePath],
    command: '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    label: `register ${bundlePath}`,
  });
};

const assertCanonicalBundle = async (
  bundlePath: string,
  readBundleIdentifier: BundleIdentifierReader,
): Promise<void> => {
  const identifier = await readBundleIdentifier(bundlePath);
  if (identifier !== RAPIDRAW_BUNDLE_IDENTIFIER) {
    throw new Error(`Refusing canonical app mutation for ${bundlePath}: unexpected bundle identifier ${identifier}.`);
  }
};

const restorePreviousBundle = async ({
  backupPath,
  installPath,
  newBundleInstalled,
  run,
}: {
  backupPath: string;
  installPath: string;
  newBundleInstalled: boolean;
  run: CommandRunner;
}): Promise<void> => {
  if (newBundleInstalled) await rm(installPath, { force: true, recursive: true });
  await rename(backupPath, installPath);
  await registerBundle(installPath, run).catch(() => undefined);
};

export const installCanonicalComputerUseApp = async ({
  installPath,
  readBundleIdentifier,
  run,
  sourcePath,
  transactionId,
}: {
  installPath: string;
  readBundleIdentifier: BundleIdentifierReader;
  run: CommandRunner;
  sourcePath: string;
  transactionId: string;
}): Promise<CanonicalInstallResult> => {
  await assertCanonicalBundle(sourcePath, readBundleIdentifier);
  await mkdir(dirname(installPath), { recursive: true });

  const transactionPrefix = join(dirname(installPath), `.${basename(installPath)}.${transactionId}`);
  const stagingPath = `${transactionPrefix}.stage`;
  const backupPath = `${transactionPrefix}.backup`;
  await rm(stagingPath, { force: true, recursive: true });
  await rm(backupPath, { force: true, recursive: true });

  let replacedExistingBundle = false;
  let backupCreated = false;
  let newBundleInstalled = false;
  try {
    await run({ args: [sourcePath, stagingPath], command: 'ditto', label: 'stage computer-use app' });
    await assertCanonicalBundle(stagingPath, readBundleIdentifier);
    await run({
      allowedExitCodes: [0, 1],
      args: ['-x', 'RapidRAW'],
      command: 'pkill',
      label: 'quit canonical RapidRAW app',
    });

    replacedExistingBundle = await pathExists(installPath);
    if (replacedExistingBundle) {
      await assertCanonicalBundle(installPath, readBundleIdentifier);
      await unregisterBundle(installPath, run);
      await rename(installPath, backupPath);
      backupCreated = true;
    }
    await rename(stagingPath, installPath);
    newBundleInstalled = true;
    await registerBundle(installPath, run);
    if (backupCreated) await rm(backupPath, { force: true, recursive: true });
    return { replacedExistingBundle };
  } catch (error) {
    if (backupCreated) {
      await restorePreviousBundle({ backupPath, installPath, newBundleInstalled, run });
    }
    throw error;
  } finally {
    await rm(stagingPath, { force: true, recursive: true });
  }
};

export const cleanupRepositoryAppBundles = async ({
  bundlePaths,
  keepPaths,
  readBundleIdentifier,
  run,
}: {
  bundlePaths: readonly string[];
  keepPaths: readonly string[];
  readBundleIdentifier: BundleIdentifierReader;
  run: CommandRunner;
}): Promise<RepositoryCleanupResult> => {
  const keep = new Set(keepPaths.map((path) => resolve(path)));
  const removed: string[] = [];
  const skippedBundleIdentifier: string[] = [];
  for (const bundlePath of bundlePaths) {
    const resolvedPath = resolve(bundlePath);
    if (keep.has(resolvedPath)) continue;
    const identifier = await readBundleIdentifier(resolvedPath).catch(() => 'unreadable');
    if (!REPOSITORY_BUNDLE_IDENTIFIERS.has(identifier)) {
      skippedBundleIdentifier.push(resolvedPath);
      continue;
    }
    await unregisterBundle(resolvedPath, run);
    await rm(resolvedPath, { force: true, recursive: true });
    removed.push(resolvedPath);
  }
  return { removed, skippedBundleIdentifier };
};

export const unregisterMissingRepositoryBundles = async ({
  paths,
  run,
}: {
  paths: readonly string[];
  run: CommandRunner;
}): Promise<string[]> => {
  const unregistered: string[] = [];
  for (const path of paths) {
    if (await pathExists(path)) continue;
    await unregisterBundle(path, run);
    unregistered.push(path);
  }
  return unregistered;
};
