#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { aiMaskCapabilityAuditSchema } from '../../../src/schemas/aiMaskingSchemas.ts';
import { AI_MASK_CAPABILITY_AUDIT, getAiMaskCapabilityAudit } from '../../../src/utils/aiMaskCapabilities.ts';

const fixture = aiMaskCapabilityAuditSchema.parse(
  JSON.parse(readFileSync(resolve('fixtures/masks/ai-mask-capabilities.json'), 'utf8')),
);
const masksSource = readFileSync(resolve('src/components/panel/right/Masks.tsx'), 'utf8');
const invokesSource = readFileSync(resolve('src/tauri/commands.ts'), 'utf8');
const rustCommandsSource = readFileSync(resolve('src-tauri/src/ai_commands.rs'), 'utf8');
const rustRenderSource = readFileSync(resolve('src-tauri/src/mask_generation.rs'), 'utf8');

if (JSON.stringify(fixture) !== JSON.stringify(AI_MASK_CAPABILITY_AUDIT)) {
  console.error('AI mask capability fixture differs from runtime audit table.');
  process.exit(1);
}

for (const entry of fixture) {
  const runtimeEntry = getAiMaskCapabilityAudit(entry.capability);
  if (JSON.stringify(runtimeEntry) !== JSON.stringify(entry)) {
    console.error(`${entry.capability}: runtime audit lookup mismatch`);
    process.exit(1);
  }

  const enumMemberPattern = new RegExp(`= '${entry.renderMaskType}'`);
  if (!enumMemberPattern.test(masksSource)) {
    console.error(`${entry.capability}: missing TS mask enum member for ${entry.renderMaskType}`);
    process.exit(1);
  }

  if (!rustRenderSource.includes(`"${entry.renderMaskType}"`)) {
    console.error(`${entry.capability}: missing Rust renderer branch for ${entry.renderMaskType}`);
    process.exit(1);
  }

  if (entry.status === 'native') {
    if (entry.invokeCommand === null) {
      console.error(`${entry.capability}: native capability missing command`);
      process.exit(1);
    }

    if (!invokesSource.includes(`'${entry.invokeCommand}'`)) {
      console.error(`${entry.capability}: missing frontend invoke command ${entry.invokeCommand}`);
      process.exit(1);
    }

    const rustFunctionName = `pub async fn ${entry.invokeCommand}`;
    if (!rustCommandsSource.includes(rustFunctionName)) {
      console.error(`${entry.capability}: missing Rust command ${rustFunctionName}`);
      process.exit(1);
    }
  } else if (entry.derivedFrom === undefined) {
    console.error(`${entry.capability}: derived capability missing source capability`);
    process.exit(1);
  }
}

console.log(`Validated ${fixture.length} AI mask capability audit entries.`);
