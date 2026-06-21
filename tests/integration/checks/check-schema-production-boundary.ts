#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const indexSource = readFileSync('packages/rawengine-schema/src/index.ts', 'utf8');
const bridgeSource = readFileSync('packages/rawengine-schema/src/localAppServerBridge.ts', 'utf8');
const sampleSource = readFileSync('packages/rawengine-schema/src/samplePayloads.ts', 'utf8');

const failures: string[] = [];

if (indexSource.includes("export * from './samplePayloads.js'")) {
  failures.push('schema package index must not export samplePayloads');
}

if (bridgeSource.includes("from './samplePayloads.js'")) {
  failures.push('localAppServerBridge must not import samplePayloads');
}

if (!bridgeSource.includes("from './toolRegistry.js'")) {
  failures.push('localAppServerBridge must import the production tool registry');
}

if (!sampleSource.includes('export const sampleToolRegistryV1 = rawEngineDefaultToolRegistryV1')) {
  failures.push('sample payloads must alias the production registry explicitly');
}

if (failures.length > 0) {
  console.error(`schema production boundary failed: ${failures.join('; ')}`);
  process.exit(1);
}

console.log('schema production boundary ok');
