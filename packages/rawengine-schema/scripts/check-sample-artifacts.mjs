#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  artifactHandleV1Schema,
  commandEnvelopeV1Schema,
  queryEnvelopeV1Schema,
  rawEngineToolRegistryV1Schema,
} from '../src/rawEngineSchemas.ts';
import {
  sampleArtifactHandleV1,
  sampleCommandEnvelopeV1,
  sampleQueryEnvelopeV1,
  sampleToolRegistryV1,
} from '../src/samplePayloads.ts';

const ROOT = process.cwd();

const sampleArtifacts = [
  {
    name: 'query envelope',
    path: 'packages/rawengine-schema/samples/query-envelope-v1.json',
    schema: queryEnvelopeV1Schema,
    value: sampleQueryEnvelopeV1,
  },
  {
    name: 'command envelope',
    path: 'packages/rawengine-schema/samples/command-envelope-v1.json',
    schema: commandEnvelopeV1Schema,
    value: sampleCommandEnvelopeV1,
  },
  {
    name: 'artifact handle',
    path: 'packages/rawengine-schema/samples/artifact-handle-v1.json',
    schema: artifactHandleV1Schema,
    value: sampleArtifactHandleV1,
  },
  {
    name: 'tool registry',
    path: 'packages/rawengine-schema/samples/tool-registry-v1.json',
    schema: rawEngineToolRegistryV1Schema,
    value: sampleToolRegistryV1,
  },
];

const toAbsolutePath = (repoPath) => join(ROOT, repoPath);
const toStableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const updateArtifacts = () => {
  for (const artifact of sampleArtifacts) {
    const absolutePath = toAbsolutePath(artifact.path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, toStableJson(artifact.value));
  }

  console.log(`Updated ${sampleArtifacts.length} RawEngine schema sample artifacts.`);
};

const checkArtifacts = () => {
  const failures = [];

  for (const artifact of sampleArtifacts) {
    const absolutePath = toAbsolutePath(artifact.path);
    const expectedContents = toStableJson(artifact.value);

    if (!existsSync(absolutePath)) {
      failures.push(`${artifact.path}: missing generated sample artifact`);
      continue;
    }

    const actualContents = readFileSync(absolutePath, 'utf8');
    if (actualContents !== expectedContents) {
      failures.push(`${artifact.path}: sample artifact drifted from ${artifact.name}`);
      continue;
    }

    const parsedArtifact = artifact.schema.safeParse(JSON.parse(actualContents));
    if (!parsedArtifact.success) {
      failures.push(`${artifact.path}: checked artifact no longer satisfies ${artifact.name} schema`);
    }
  }

  if (failures.length > 0) {
    console.error('RawEngine schema sample artifact check failed.');
    console.error('Refresh intentional changes with: bun run schema:samples:update');
    console.error(failures.join('\n'));
    process.exit(1);
  }

  console.log(`RawEngine schema sample artifact check passed for ${sampleArtifacts.length} artifacts.`);
};

const args = new Set(process.argv.slice(2));

if (args.has('--update')) {
  updateArtifacts();
} else {
  checkArtifacts();
}
