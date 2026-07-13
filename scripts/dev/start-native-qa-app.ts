#!/usr/bin/env bun

import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { processStartToken } from '../qa/identity';
import { readLiveNativeQaControlRecord, readNativeQaControlRecord, requestNativeQaControl } from '../qa/native-control';
import { computeNativeQaIdentity, type NativeQaIdentity, planNativeQaDeployment } from '../qa/native-identity';

const sourceAppPath = 'src-tauri/target/debug/bundle/macos/RapidRAW.app';
const qaAppPath = 'src-tauri/target/debug/bundle/macos/RawEngine QA Current.app';
const qaAppName = 'RawEngine QA Current';
const qaBundleIdentifier = 'dev.rawengine.RapidRAW.qa-current';
const qaExecutablePath = `${qaAppPath}/Contents/MacOS/RapidRAW`;
const args = process.argv.slice(2);
const shouldBuild = !args.includes('--no-build');
const shouldLaunch = !args.includes('--no-launch');
const clean = args.includes('--clean');
const devServer = args.includes('--dev-server');
const validationHarness = args.includes('--validation-harness');
const buildFeatures = validationHarness ? 'required-ci,validation-harness' : 'required-ci';
const identityPath = 'src-tauri/target/debug/bundle/macos/rawengine-qa-identity.json';
const controlRecordPath = resolve('private-artifacts/qa/native-control.json');
const identity = await computeNativeQaIdentity(buildFeatures);
const previousIdentity = await readFile(identityPath, 'utf8')
  .then((value) => JSON.parse(value) as NativeQaIdentity)
  .catch(() => undefined);
const deployment = planNativeQaDeployment(previousIdentity, identity, { clean, devServer });

async function run(command: string, commandArgs: string[], label: string, allowedExitCodes = [0]): Promise<void> {
  const proc = Bun.spawn([command, ...commandArgs], {
    stderr: 'pipe',
    stdout: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (allowedExitCodes.includes(exitCode)) return;

  console.error(`${label} failed`);
  const output = `${stdout}\n${stderr}`.trim();
  console.error(output.split('\n').slice(-40).join('\n'));
  process.exit(exitCode);
}

if (shouldBuild && deployment.build) {
  await run(
    'bun',
    [
      'scripts/ci/run-resource-coordinated.ts',
      '--resource',
      'native-heavy',
      '--label',
      'native-qa-build',
      '--',
      'bun',
      'tauri',
      'build',
      '--debug',
      '--ci',
      '--bundles',
      'app',
      '--features',
      buildFeatures,
    ],
    'native qa app build',
  );
}

if (deployment.copy || shouldLaunch) {
  const previousControl = await readLiveNativeQaControlRecord(controlRecordPath, identity.worktree);
  if (previousControl !== undefined) {
    await requestNativeQaControl(previousControl, 'shutdown').catch(() => undefined);
    for (
      let attempt = 0;
      attempt < 100 && Bun.spawnSync(['kill', '-0', String(previousControl.pid)]).exitCode === 0;
      attempt += 1
    )
      await Bun.sleep(25);
  }
  if (previousControl === undefined || Bun.spawnSync(['kill', '-0', String(previousControl.pid)]).exitCode === 0)
    await run('pkill', ['-f', `${qaAppName}.app/Contents/MacOS/RapidRAW`], 'native qa stale app quit', [0, 1]);
}

if (deployment.copy) {
  await rm(qaAppPath, { force: true, recursive: true });
  await mkdir(dirname(qaAppPath), { recursive: true });
  await run('cp', ['-R', sourceAppPath, qaAppPath], 'native qa app copy');

  const plistPath = `${qaAppPath}/Contents/Info.plist`;
  for (const [key, value] of [
    ['CFBundleName', qaAppName],
    ['CFBundleDisplayName', qaAppName],
    ['CFBundleIdentifier', qaBundleIdentifier],
  ]) {
    await run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath], `native qa app plist ${key}`);
  }

  if (deployment.sign)
    await run('codesign', ['--force', '--deep', '--sign', '-', qaAppPath], 'native qa app ad-hoc codesign');
  await writeFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`);
}

if (shouldLaunch) {
  if (!validationHarness) {
    await run('open', ['-n', qaAppPath], 'native qa app launch');
  } else {
    await mkdir(dirname(controlRecordPath), { recursive: true });
    const buildIdentity = createHash('sha256')
      .update(identity.native)
      .update(identity.frontend)
      .update(identity.bundle)
      .digest('hex');
    const socketPath = `/tmp/rawengine-native-qa-${createHash('sha256').update(identity.worktree).digest('hex').slice(0, 16)}.sock`;
    const token = randomBytes(32).toString('hex');
    const logPath = resolve('private-artifacts/qa/native-control-stderr.log');
    await rm(socketPath, { force: true });
    await rm(logPath, { force: true });
    const process = Bun.spawn([resolve(qaExecutablePath)], {
      cwd: identity.worktree,
      detached: true,
      env: {
        ...Bun.env,
        RAWENGINE_QA_BUILD_IDENTITY: buildIdentity,
        RAWENGINE_QA_CONTROL_SOCKET: socketPath,
        RAWENGINE_QA_CONTROL_TOKEN: token,
        RAWENGINE_QA_WORKTREE_IDENTITY: identity.worktree,
      },
      stderr: Bun.file(logPath),
      stdout: 'ignore',
    });
    process.unref();
    const startToken = await processStartToken(process.pid);
    if (startToken === undefined) {
      process.kill('SIGTERM');
      throw new Error('Cannot determine native QA app process identity.');
    }
    await writeFile(
      controlRecordPath,
      `${JSON.stringify({ schemaVersion: 1, pid: process.pid, processStartToken: startToken, socketPath, token, logPath, identity: { worktree: identity.worktree, build: buildIdentity } }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await chmod(controlRecordPath, 0o600);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const control = await readNativeQaControlRecord(controlRecordPath);
      if (control !== undefined) {
        const response = await requestNativeQaControl(control, 'health').catch(() => undefined);
        if (response?.ok) break;
      }
      if (process.exitCode !== null) {
        const log = await readFile(logPath, 'utf8').catch(() => 'native control log unavailable');
        throw new Error(
          `Native QA app exited during launch (${process.exitCode}):\n${log.split('\n').slice(-30).join('\n')}`,
        );
      }
      await Bun.sleep(50);
      if (attempt === 199) {
        const log = await readFile(logPath, 'utf8').catch(() => 'native control log unavailable');
        throw new Error(`Native QA control channel did not become ready:\n${log.split('\n').slice(-30).join('\n')}`);
      }
    }
  }
}

console.log(
  `native qa app ok (${deployment.reason}; ${identity.native.slice(0, 12)}; ${qaAppName}; ${qaBundleIdentifier}; ${qaAppPath}; control=${shouldLaunch && validationHarness ? controlRecordPath : 'disabled'})`,
);
