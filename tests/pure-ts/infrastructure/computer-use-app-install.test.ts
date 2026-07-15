import { afterEach, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CommandRequest,
  cleanupRepositoryAppBundles,
  discoverRepositoryAppBundles,
  findStaleRepositoryRegistrationPaths,
  installCanonicalComputerUseApp,
  parseComputerUseInstallOptions,
  parseGitWorktreePaths,
  parseLaunchServicesRegistrations,
  RAPIDRAW_BUNDLE_IDENTIFIER,
  RAWENGINE_QA_BUNDLE_IDENTIFIER,
  unregisterMissingRepositoryBundles,
} from '../../../scripts/dev/computer-use-app-install';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

const makeTemporaryDirectory = async (name: string): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), `${name}-`));
  temporaryDirectories.push(path);
  return path;
};

const writeBundle = async (path: string, identifier: string, payload: string): Promise<void> => {
  await mkdir(join(path, 'Contents'), { recursive: true });
  await writeFile(join(path, 'Contents', 'bundle-id.txt'), identifier);
  await writeFile(join(path, 'Contents', 'payload.txt'), payload);
};

const readBundleIdentifier = (path: string): Promise<string> =>
  readFile(join(path, 'Contents', 'bundle-id.txt'), 'utf8');

const createFakeRunner = ({ failFirstRegistration = false }: { failFirstRegistration?: boolean } = {}) => {
  const requests: CommandRequest[] = [];
  let shouldFailRegistration = failFirstRegistration;
  const run = async (request: CommandRequest) => {
    requests.push(request);
    if (request.command === 'ditto') await cp(request.args[0]!, request.args[1]!, { recursive: true });
    if (request.label.startsWith('register ') && shouldFailRegistration) {
      shouldFailRegistration = false;
      throw new Error('synthetic registration failure');
    }
    return { exitCode: 0, stderr: '', stdout: '' };
  };
  return { requests, run };
};

test('computer-use options preserve flags, custom paths, and reject malformed input', () => {
  expect(parseComputerUseInstallOptions([], '/repo')).toEqual({
    installPath: '/Applications/RapidRAW.app',
    shouldBuild: true,
    shouldInstall: true,
    shouldLaunch: true,
    verboseBuildLogs: true,
  });
  expect(
    parseComputerUseInstallOptions(
      ['--no-build', '--no-install', '--no-launch', '--compact', '--app-path', 'Apps With Spaces/RapidRAW.app'],
      '/repo',
    ),
  ).toEqual({
    installPath: '/repo/Apps With Spaces/RapidRAW.app',
    shouldBuild: false,
    shouldInstall: false,
    shouldLaunch: false,
    verboseBuildLogs: false,
  });
  expect(() => parseComputerUseInstallOptions(['--app-path'])).toThrow('--app-path requires a path value');
  expect(() => parseComputerUseInstallOptions(['--surprise'])).toThrow('Unknown computer-use install option');
});

test('worktree discovery is targeted and preserves paths with spaces', async () => {
  const root = await makeTemporaryDirectory('computer-use worktrees');
  const first = join(root, 'Rapid Raw Main');
  const second = join(root, 'Rapid Raw Linked');
  const expected = [
    join(first, 'src-tauri/target/release/bundle/macos/RapidRAW.app'),
    join(second, 'src-tauri/target/debug/bundle/macos/RawEngine QA Current.app'),
  ];
  await writeBundle(expected[0]!, RAPIDRAW_BUNDLE_IDENTIFIER, 'release');
  await writeBundle(expected[1]!, RAWENGINE_QA_BUNDLE_IDENTIFIER, 'debug');
  await writeBundle(join(first, 'unrelated/RapidRAW.app'), RAPIDRAW_BUNDLE_IDENTIFIER, 'outside-target');

  const porcelain = `worktree ${first}\0HEAD aaa\0\0worktree ${second}\0HEAD bbb\0\0`;
  expect(parseGitWorktreePaths(porcelain)).toEqual([first, second]);
  expect(await discoverRepositoryAppBundles(parseGitWorktreePaths(porcelain))).toEqual(expected.sort());
});

test('stale registration cleanup is constrained to repository targets and known proof bundles', async () => {
  const main = '/Users/test/RawEngine/RapidRaw';
  const linked = '/Users/test/RawEngine/RapidRaw-current';
  const canonical = '/Applications/RapidRAW.app';
  const staleTarget = '/Users/test/RawEngine/RapidRaw-old/src-tauri/target/release/bundle/macos/RapidRAW.app';
  const staleProof = '/private/tmp/RapidRAW-export-proof.app';
  const unrelated = '/Users/test/Other/src-tauri/target/release/bundle/macos/RapidRAW.app';
  const dump = [
    `path:                       ${canonical} (0x1000)`,
    `identifier:                 ${RAPIDRAW_BUNDLE_IDENTIFIER}`,
    `path:                       ${staleTarget} (0x1001)`,
    `identifier:                 ${RAPIDRAW_BUNDLE_IDENTIFIER}`,
    `path:                       ${staleProof} (0x1002)`,
    `identifier:                 ${RAPIDRAW_BUNDLE_IDENTIFIER}`,
    `path:                       ${unrelated} (0x1003)`,
    `identifier:                 ${RAPIDRAW_BUNDLE_IDENTIFIER}`,
    `path:                       /Users/test/RawEngine/RapidRaw-old/src-tauri/target/debug/bundle/macos/Other.app (0x1004)`,
    'identifier:                 com.example.Other',
  ].join('\n');

  const registrations = parseLaunchServicesRegistrations(dump);
  expect(registrations).toHaveLength(5);
  expect(
    findStaleRepositoryRegistrationPaths({
      canonicalPath: canonical,
      mainWorktreePath: main,
      registrations,
      worktreePaths: [main, linked],
    }),
  ).toEqual([staleTarget, staleProof]);

  const fake = createFakeRunner();
  expect(await unregisterMissingRepositoryBundles({ paths: [staleProof, staleTarget], run: fake.run })).toEqual([
    staleProof,
    staleTarget,
  ]);
  expect(fake.requests.filter((request) => request.label.startsWith('unregister '))).toHaveLength(2);
});

test('repository cleanup removes only allowlisted bundles and honors the canonical keep path', async () => {
  const root = await makeTemporaryDirectory('computer-use cleanup');
  const canonical = join(root, 'canonical/RapidRAW.app');
  const stale = join(root, 'release/RapidRAW.app');
  const qa = join(root, 'debug/RawEngine QA Current.app');
  const unrelated = join(root, 'debug/Unrelated.app');
  await writeBundle(canonical, RAPIDRAW_BUNDLE_IDENTIFIER, 'keep');
  await writeBundle(stale, RAPIDRAW_BUNDLE_IDENTIFIER, 'stale');
  await writeBundle(qa, RAWENGINE_QA_BUNDLE_IDENTIFIER, 'qa');
  await writeBundle(unrelated, 'com.example.Unrelated', 'unrelated');
  const fake = createFakeRunner();

  const result = await cleanupRepositoryAppBundles({
    bundlePaths: [canonical, stale, qa, unrelated],
    keepPaths: [canonical],
    readBundleIdentifier,
    run: fake.run,
  });

  expect(result.removed).toEqual([stale, qa]);
  expect(result.skippedBundleIdentifier).toEqual([unrelated]);
  expect(await readdir(join(root, 'release'))).toEqual([]);
  expect(await readFile(join(canonical, 'Contents', 'payload.txt'), 'utf8')).toBe('keep');
  expect(await readFile(join(unrelated, 'Contents', 'payload.txt'), 'utf8')).toBe('unrelated');
  expect(fake.requests.filter((request) => request.label.startsWith('unregister '))).toHaveLength(2);
});

test('canonical reinstall replaces atomically and handles paths with spaces', async () => {
  const root = await makeTemporaryDirectory('computer-use atomic install');
  const source = join(root, 'Source With Spaces/RapidRAW.app');
  const install = join(root, 'Applications With Spaces/RapidRAW.app');
  await writeBundle(source, RAPIDRAW_BUNDLE_IDENTIFIER, 'new');
  await writeBundle(install, RAPIDRAW_BUNDLE_IDENTIFIER, 'old');
  const fake = createFakeRunner();

  const result = await installCanonicalComputerUseApp({
    installPath: install,
    readBundleIdentifier,
    run: fake.run,
    sourcePath: source,
    transactionId: 'test-transaction',
  });

  expect(result.replacedExistingBundle).toBe(true);
  expect(await readFile(join(install, 'Contents', 'payload.txt'), 'utf8')).toBe('new');
  expect(fake.requests.map((request) => request.label)).toContain(`unregister ${install}`);
  expect(fake.requests.map((request) => request.label)).toContain(`register ${install}`);
  expect((await readdir(join(root, 'Applications With Spaces'))).sort()).toEqual(['RapidRAW.app']);
});

test('failed registration rolls back to the previous complete canonical bundle', async () => {
  const root = await makeTemporaryDirectory('computer-use rollback');
  const source = join(root, 'source/RapidRAW.app');
  const install = join(root, 'applications/RapidRAW.app');
  await writeBundle(source, RAPIDRAW_BUNDLE_IDENTIFIER, 'new');
  await writeBundle(install, RAPIDRAW_BUNDLE_IDENTIFIER, 'old');
  const fake = createFakeRunner({ failFirstRegistration: true });

  await expect(
    installCanonicalComputerUseApp({
      installPath: install,
      readBundleIdentifier,
      run: fake.run,
      sourcePath: source,
      transactionId: 'rollback-transaction',
    }),
  ).rejects.toThrow('synthetic registration failure');

  expect(await readFile(join(install, 'Contents', 'payload.txt'), 'utf8')).toBe('old');
  expect((await readdir(join(root, 'applications'))).sort()).toEqual(['RapidRAW.app']);
});

test('canonical mutation refuses unrelated source or destination bundle identifiers', async () => {
  const root = await makeTemporaryDirectory('computer-use identity gate');
  const source = join(root, 'source/RapidRAW.app');
  const install = join(root, 'applications/RapidRAW.app');
  await writeBundle(source, RAPIDRAW_BUNDLE_IDENTIFIER, 'new');
  await writeBundle(install, 'com.example.Unrelated', 'keep');
  const fake = createFakeRunner();

  await expect(
    installCanonicalComputerUseApp({
      installPath: install,
      readBundleIdentifier,
      run: fake.run,
      sourcePath: source,
      transactionId: 'identity-transaction',
    }),
  ).rejects.toThrow('unexpected bundle identifier com.example.Unrelated');

  expect(await readFile(join(install, 'Contents', 'payload.txt'), 'utf8')).toBe('keep');
  expect(fake.requests.some((request) => request.label === `unregister ${install}`)).toBe(false);
});
