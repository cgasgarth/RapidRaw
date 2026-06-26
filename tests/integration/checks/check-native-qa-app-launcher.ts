#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const source = readFileSync('scripts/start-native-qa-app.ts', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};

const failures: string[] = [];

if (packageJson.scripts?.['start:native-qa'] !== 'bun scripts/start-native-qa-app.ts') {
  failures.push('package.json must expose start:native-qa for Computer Use sweeps.');
}

for (const marker of [
  "const sourceAppPath = 'src-tauri/target/debug/bundle/macos/RapidRAW.app'",
  "const qaAppPath = 'src-tauri/target/debug/bundle/macos/RawEngine QA Current.app'",
  "const qaAppName = 'RawEngine QA Current'",
  "const qaBundleIdentifier = 'dev.rawengine.RapidRAW.qa-current'",
  "['CFBundleName', qaAppName]",
  "['CFBundleDisplayName', qaAppName]",
  "['CFBundleIdentifier', qaBundleIdentifier]",
  "await run('codesign', ['--force', '--deep', '--sign', '-', qaAppPath], 'native qa app ad-hoc codesign')",
  "await run('open', ['-n', qaAppPath], 'native qa app launch')",
]) {
  if (!source.includes(marker)) failures.push(`native QA launcher missing ${marker}`);
}

if (!source.includes("const shouldLaunch = !args.includes('--no-launch')")) {
  failures.push('native QA launcher needs --no-launch for noninteractive validation.');
}

if (failures.length > 0) {
  console.error('native qa app launcher failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('native qa app launcher ok');
