#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { aiMaskCapabilityAuditSchema } from '../../../src/schemas/aiMaskingSchemas.ts';
import { AI_MASK_CAPABILITY_AUDIT, getAiMaskCapabilityAudit } from '../../../src/utils/ai/aiMaskCapabilities.ts';

const fixture = aiMaskCapabilityAuditSchema.parse(
  JSON.parse(readFileSync(resolve('fixtures/masks/ai/ai-mask-capabilities.json'), 'utf8')),
);

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

  if (entry.status === 'native' && entry.invokeCommand === null) {
    console.error(`${entry.capability}: native capability missing command metadata`);
    process.exit(1);
  }

  if (entry.status === 'derived' && entry.derivedFrom === undefined) {
    console.error(`${entry.capability}: derived capability missing source capability`);
    process.exit(1);
  }
}

console.log(`Validated ${fixture.length} AI mask capability audit entries.`);
