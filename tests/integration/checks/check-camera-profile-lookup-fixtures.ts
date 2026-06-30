#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { z } from 'zod';

import {
  cameraProfileEntrySchema,
  cameraProfileFallbackSchema,
  cameraProfileLookupCatalogSchema,
  lookupCameraProfile,
} from '../../../src/utils/cameraProfileLookup.ts';

const FIXTURE_PATH = 'fixtures/color/reference/camera-profile-lookup-fixtures.json';

const lookupCaseSchema = z.object({
  id: z.string().min(1),
  metadata: z.object({
    manufacturer: z.string().min(1),
    model: z.string().min(1),
    rawExtension: z.string().min(1),
  }),
  expectedProfileId: z.string().min(1),
  expectedWarning: z.enum(['camera_profile_embedded_fallback', 'camera_profile_generic_fallback']).nullable(),
});

const fixtureSchema = z.object({
  cases: z.array(lookupCaseSchema).min(1),
  fallbacks: z.array(cameraProfileFallbackSchema).min(1),
  profiles: z.array(cameraProfileEntrySchema).min(1),
  schemaVersion: z.literal(1),
});

const fixture = fixtureSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')));
const catalog = cameraProfileLookupCatalogSchema.parse({
  fallbacks: fixture.fallbacks,
  profiles: fixture.profiles,
  schemaVersion: fixture.schemaVersion,
});

for (const testCase of fixture.cases) {
  const result = lookupCameraProfile(catalog, testCase.metadata);
  if (result.id !== testCase.expectedProfileId || result.warning !== testCase.expectedWarning) {
    throw new Error(
      `${testCase.id}: expected ${testCase.expectedProfileId}/${testCase.expectedWarning ?? 'none'}, got ${
        result.id
      }/${result.warning ?? 'none'}`,
    );
  }
}

console.log(`Validated ${fixture.cases.length} camera profile lookup fixture cases.`);
