#!/usr/bin/env bun

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { computeNativeQaIdentity, type NativeQaIdentity, planNativeQaDeployment } from '../qa/native-identity';

const sourceAppPath = 'src-tauri/target/debug/bundle/macos/RapidRAW.app';
const qaAppPath = 'src-tauri/target/debug/bundle/macos/RawEngine QA Current.app';
const qaAppName = 'RawEngine QA Current';
const qaBundleIdentifier = 'dev.rawengine.RapidRAW.qa-current';
const args = process.argv.slice(2);
const shouldBuild = !args.includes('--no-build');
const shouldLaunch = !args.includes('--no-launch');
const clean = args.includes('--clean');
const devServer = args.includes('--dev-server');
const buildFeatures = args.includes('--validation-harness') ? 'required-ci,validation-harness' : 'required-ci';
const identityPath = 'src-tauri/target/debug/bundle/macos/rawengine-qa-identity.json';
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

if (deployment.copy) {
  await run('pkill', ['-f', `${qaAppName}.app/Contents/MacOS/RapidRAW`], 'native qa stale app quit', [0, 1]);
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
  await run('open', ['-n', qaAppPath], 'native qa app launch');
}

console.log(
  `native qa app ok (${deployment.reason}; ${identity.native.slice(0, 12)}; ${qaAppName}; ${qaBundleIdentifier}; ${qaAppPath})`,
);
