#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { z } from 'zod';

const FIXTURE_PATH = 'fixtures/color/camera-profile-lookup-fixtures.json';

const profileClassSchema = z.enum(['generic_camera_profile', 'measured_camera_profile', 'licensed_camera_profile']);
const inputTransformSchema = z.enum([
  'dng_color_matrix',
  'embedded_dng_color_matrix',
  'libraw_camera_matrix',
  'raw_decoder_neutral_matrix',
]);
const warningSchema = z.enum(['camera_profile_embedded_fallback', 'camera_profile_generic_fallback']);

const profileSchema = z.object({
  id: z.string().min(1),
  manufacturer: z.string().min(1),
  models: z.array(z.string().min(1)).min(1),
  rawExtensions: z.array(z.string().min(1)).min(1),
  inputTransform: inputTransformSchema,
  profileClass: profileClassSchema,
  source: z.string().min(1),
  priority: z.number().int().nonnegative(),
});

const fallbackSchema = z.object({
  id: z.string().min(1),
  rawExtensions: z.array(z.string().min(1)).min(1),
  inputTransform: inputTransformSchema,
  warning: warningSchema,
});

const metadataSchema = z.object({
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  rawExtension: z.string().min(1),
});

const lookupCaseSchema = z.object({
  id: z.string().min(1),
  metadata: metadataSchema,
  expectedProfileId: z.string().min(1),
  expectedWarning: warningSchema.nullable(),
});

const fixtureSchema = z.object({
  schemaVersion: z.literal(1),
  profiles: z.array(profileSchema).min(1),
  fallbacks: z.array(fallbackSchema).min(1),
  cases: z.array(lookupCaseSchema).min(1),
});

const normalize = (value) => value.trim().toLowerCase();
const normalizeExtension = (value) => normalize(value).replace(/^\./u, '');

const fixture = fixtureSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')));

const ids = new Set();
for (const entry of [...fixture.profiles, ...fixture.fallbacks]) {
  if (ids.has(entry.id)) throw new Error(`Duplicate profile/fallback id: ${entry.id}`);
  ids.add(entry.id);
}

const lookupProfile = (metadata) => {
  const manufacturer = normalize(metadata.manufacturer);
  const model = normalize(metadata.model);
  const extension = normalizeExtension(metadata.rawExtension);

  const matchedProfiles = fixture.profiles
    .filter((profile) => profile.rawExtensions.map(normalizeExtension).includes(extension))
    .filter((profile) => normalize(profile.manufacturer) === manufacturer)
    .filter((profile) => profile.models.map(normalize).includes(model))
    .sort((left, right) => right.priority - left.priority);

  if (matchedProfiles[0]) {
    return { id: matchedProfiles[0].id, warning: null };
  }

  const fallback = fixture.fallbacks.find((candidate) =>
    candidate.rawExtensions.map(normalizeExtension).includes(extension),
  );
  if (!fallback) throw new Error(`No fallback covers extension: ${extension}`);

  return { id: fallback.id, warning: fallback.warning };
};

for (const testCase of fixture.cases) {
  const result = lookupProfile(testCase.metadata);
  if (result.id !== testCase.expectedProfileId || result.warning !== testCase.expectedWarning) {
    throw new Error(
      `${testCase.id}: expected ${testCase.expectedProfileId}/${testCase.expectedWarning ?? 'none'}, got ${
        result.id
      }/${result.warning ?? 'none'}`,
    );
  }
}

console.log(`Validated ${fixture.cases.length} camera profile lookup fixture cases.`);
