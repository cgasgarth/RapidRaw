#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { z } from 'zod';
import {
  aiSidecarProvenanceEntryV1Schema,
  hdrMergeArtifactV1Schema,
  panoramaArtifactV1Schema,
} from '../packages/rawengine-schema/src/rawEngineSchemas.ts';

const ROOT = process.cwd();
const FIXTURE_DIR = 'fixtures/sidecar-roundtrip';
const PRIMARY_IMAGE_PATH = '/fixture-roll/IMG_0001.CR3';
const HDR_IMAGE_PATH = '/fixture-roll/IMG_HDR_0001.CR3';
const PANORAMA_IMAGE_PATH = '/fixture-roll/IMG_PANO_0001.CR3';
const VIRTUAL_COPY_ID = 'a1b2c3';

const COLOR_LABELS = new Set(['red', 'yellow', 'green', 'blue', 'purple']);
const DEFAULT_METADATA = {
  version: 1,
  rating: 0,
  adjustments: null,
  tags: null,
};

const JsonValueSchema = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const RawEngineArtifactsSchema = z
  .object({
    aiProvenanceEntries: z.array(aiSidecarProvenanceEntryV1Schema).default([]),
    hdrMergeArtifacts: z.array(hdrMergeArtifactV1Schema).default([]),
    panoramaArtifacts: z.array(panoramaArtifactV1Schema).default([]),
    schemaVersion: z.literal(1),
    staleArtifactIds: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

const SidecarSchema = z
  .object({
    version: z.number().int().nonnegative(),
    rating: z.number().int().min(0).max(255),
    adjustments: JsonValueSchema,
    tags: z.array(z.string().min(1)).nullable().optional(),
    exif: z.record(z.string(), z.string()).optional(),
    rawEngineArtifacts: RawEngineArtifactsSchema.optional(),
  })
  .passthrough();

const AdjustmentMapSchema = z.record(z.string(), JsonValueSchema);

const toAbsolutePath = (repoPath) => join(ROOT, repoPath);
const toRepoPath = (absolutePath) => relative(ROOT, absolutePath).split('/').join('/');

const fail = (message, details = []) => {
  console.error(message);
  if (details.length > 0) {
    console.error(details.map((detail) => `- ${detail}`).join('\n'));
  }
  process.exit(1);
};

const readFixture = async (repoPath) => {
  const absolutePath = toAbsolutePath(repoPath);
  if (!existsSync(absolutePath)) {
    fail(`Missing sidecar roundtrip fixture: ${repoPath}`);
  }

  return readFile(absolutePath, 'utf8');
};

const loadSidecarFixture = (contents) => {
  if (contents === undefined) {
    return { metadata: DEFAULT_METADATA, usedDefault: true };
  }

  try {
    const parsed = JSON.parse(contents);
    const metadata = SidecarSchema.parse(parsed);

    return { metadata, usedDefault: false };
  } catch (_error) {
    return { metadata: DEFAULT_METADATA, usedDefault: true };
  }
};

const deriveSidecarPath = (imagePath) => {
  const [physicalPath, query] = imagePath.split('?');
  const params = new URLSearchParams(query ?? '');
  const virtualCopyId = params.get('vc');

  if (virtualCopyId === null) {
    return `${physicalPath}.rrdata`;
  }

  if (!/^[a-f0-9]{6}$/u.test(virtualCopyId)) {
    throw new Error(`Virtual copy id must be six lowercase hex characters: ${virtualCopyId}`);
  }

  return `${physicalPath}.${virtualCopyId}.rrdata`;
};

const assertEqual = (actual, expected, label) => {
  if (actual !== expected) {
    fail(`${label} mismatch.`, [`expected ${expected}`, `received ${actual}`]);
  }
};

const assertJsonEqual = (actual, expected, label) => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    fail(`${label} mismatch.`, [`expected ${expectedJson}`, `received ${actualJson}`]);
  }
};

const assertTagConventions = (tags) => {
  const normalizedTags = tags ?? [];
  const sortedUniqueTags = [...new Set(normalizedTags)].sort((a, b) => a.localeCompare(b));
  assertJsonEqual(normalizedTags, sortedUniqueTags, 'tags must be sorted and deduplicated');

  const colorTags = normalizedTags.filter((tag) => tag.startsWith('color:'));
  if (colorTags.length !== 1) {
    fail('sidecar fixture must contain exactly one color label tag', colorTags);
  }

  const userTags = normalizedTags.filter((tag) => tag.startsWith('user:'));
  if (userTags.length === 0) {
    fail('sidecar fixture must contain at least one user tag');
  }

  const aiTags = normalizedTags.filter((tag) => !tag.includes(':'));
  if (aiTags.length === 0) {
    fail('sidecar fixture must contain at least one plain AI tag');
  }

  for (const tag of normalizedTags) {
    if (tag.startsWith('color:')) {
      const color = tag.slice('color:'.length);
      if (!COLOR_LABELS.has(color)) {
        fail('unknown sidecar color label', [`${tag} is not one of ${[...COLOR_LABELS].join(', ')}`]);
      }
      continue;
    }

    if (tag.startsWith('user:')) {
      if (tag.length === 'user:'.length) {
        fail('user tag prefix must include a non-empty tag name', [tag]);
      }
      continue;
    }

    if (tag.includes(':')) {
      fail('AI tags should be plain strings without reserved prefixes', [tag]);
    }
  }
};

const assertRoundtripPreservesAdjustments = (metadata) => {
  const adjustments = AdjustmentMapSchema.parse(metadata.adjustments);
  const roundtripped = SidecarSchema.parse(JSON.parse(JSON.stringify(metadata, null, 2)));
  const roundtrippedAdjustments = AdjustmentMapSchema.parse(roundtripped.adjustments);

  assertJsonEqual(
    roundtrippedAdjustments.rawEngineFutureControl,
    adjustments.rawEngineFutureControl,
    'unknown adjustment key roundtrip',
  );
};

const primaryFixturePath = `${FIXTURE_DIR}/IMG_0001.CR3.rrdata`;
const hdrFixturePath = `${FIXTURE_DIR}/IMG_HDR_0001.CR3.rrdata`;
const panoramaFixturePath = `${FIXTURE_DIR}/IMG_PANO_0001.CR3.rrdata`;
const virtualFixturePath = `${FIXTURE_DIR}/IMG_0001.CR3.${VIRTUAL_COPY_ID}.rrdata`;

const primaryContents = await readFixture(primaryFixturePath);
const hdrContents = await readFixture(hdrFixturePath);
const panoramaContents = await readFixture(panoramaFixturePath);
const virtualContents = await readFixture(virtualFixturePath);

const primary = loadSidecarFixture(primaryContents);
const hdr = loadSidecarFixture(hdrContents);
const panorama = loadSidecarFixture(panoramaContents);
const virtualCopy = loadSidecarFixture(virtualContents);

if (primary.usedDefault) {
  fail(`${primaryFixturePath} should parse as a valid primary sidecar fixture`);
}

if (virtualCopy.usedDefault) {
  fail(`${virtualFixturePath} should parse as a valid virtual copy sidecar fixture`);
}

if (hdr.usedDefault) {
  fail(`${hdrFixturePath} should parse as a valid HDR artifact sidecar fixture`);
}

if (panorama.usedDefault) {
  fail(`${panoramaFixturePath} should parse as a valid panorama artifact sidecar fixture`);
}

assertEqual(primary.metadata.version, 1, 'primary sidecar version');
assertEqual(primary.metadata.rating, 4, 'primary sidecar rating');
assertRoundtripPreservesAdjustments(primary.metadata);
assertTagConventions(primary.metadata.tags);

if (!primary.metadata.exif) {
  fail('primary sidecar fixture must include EXIF metadata');
}

assertEqual(primary.metadata.exif.Make, 'FixtureCam', 'primary EXIF Make');
assertEqual(primary.metadata.exif.Model, 'Deterministic 1', 'primary EXIF Model');

const primaryArtifacts = RawEngineArtifactsSchema.parse(primary.metadata.rawEngineArtifacts);
assertEqual(primaryArtifacts.schemaVersion, 1, 'primary rawEngineArtifacts schema version');
assertEqual(primaryArtifacts.aiProvenanceEntries.length, 2, 'primary AI provenance entry count');
assertEqual(primaryArtifacts.hdrMergeArtifacts.length, 0, 'primary HDR artifact count');
assertEqual(primaryArtifacts.panoramaArtifacts.length, 0, 'primary panorama artifact count');

const [maskProvenance, enhancementProvenance] = primaryArtifacts.aiProvenanceEntries;
assertEqual(maskProvenance.providerId, 'rawengine-local-ai', 'AI mask provider id');
assertEqual(maskProvenance.modelId, 'local_sam2_subject_mask', 'AI mask model id');
assertEqual(maskProvenance.settingsHash, 'sha256:sample-ai-subject-mask-settings', 'AI mask settings hash');
assertEqual(enhancementProvenance.capability, 'denoise', 'AI enhancement capability');
assertEqual(enhancementProvenance.qualityPreference, 'balanced', 'AI enhancement quality preference');

const roundtrippedPrimaryArtifacts = SidecarSchema.parse(
  JSON.parse(JSON.stringify(primary.metadata, null, 2)),
).rawEngineArtifacts;
assertJsonEqual(roundtrippedPrimaryArtifacts, primaryArtifacts, 'AI provenance sidecar roundtrip');

assertEqual(deriveSidecarPath(PRIMARY_IMAGE_PATH), '/fixture-roll/IMG_0001.CR3.rrdata', 'primary sidecar path');
assertEqual(
  deriveSidecarPath(PANORAMA_IMAGE_PATH),
  '/fixture-roll/IMG_PANO_0001.CR3.rrdata',
  'panorama artifact sidecar path',
);
assertEqual(deriveSidecarPath(HDR_IMAGE_PATH), '/fixture-roll/IMG_HDR_0001.CR3.rrdata', 'HDR artifact sidecar path');
assertEqual(
  deriveSidecarPath(`${PRIMARY_IMAGE_PATH}?vc=${VIRTUAL_COPY_ID}`),
  `/fixture-roll/IMG_0001.CR3.${VIRTUAL_COPY_ID}.rrdata`,
  'virtual copy sidecar path',
);

const invalidVirtualPaths = [
  `${PRIMARY_IMAGE_PATH}?vc=A1B2C3`,
  `${PRIMARY_IMAGE_PATH}?vc=abc1234`,
  `${PRIMARY_IMAGE_PATH}?vc=abc12z`,
];

const invalidVirtualFailures = [];
for (const invalidVirtualPath of invalidVirtualPaths) {
  try {
    deriveSidecarPath(invalidVirtualPath);
    invalidVirtualFailures.push(invalidVirtualPath);
  } catch (_error) {
    // Expected: scanner-compatible virtual copy ids are six lowercase hex characters.
  }
}

if (invalidVirtualFailures.length > 0) {
  fail('invalid virtual copy ids were accepted', invalidVirtualFailures);
}

assertRoundtripPreservesAdjustments(virtualCopy.metadata);
assertTagConventions(virtualCopy.metadata.tags);

const hdrArtifacts = RawEngineArtifactsSchema.parse(hdr.metadata.rawEngineArtifacts);
assertEqual(hdrArtifacts.schemaVersion, 1, 'HDR rawEngineArtifacts schema version');
assertEqual(hdrArtifacts.hdrMergeArtifacts.length, 1, 'HDR artifact count');
assertEqual(hdrArtifacts.staleArtifactIds.length, 0, 'HDR stale artifact count');

const [hdrArtifact] = hdrArtifacts.hdrMergeArtifacts;
assertEqual(hdrArtifact.family, 'hdr', 'HDR artifact family');
assertEqual(hdrArtifact.editableDerivedAssetId, 'derived_hdr_window_light', 'HDR editable derived asset id');
assertEqual(hdrArtifact.outputArtifact.storage, 'sidecar_artifact', 'HDR output artifact storage');
assertEqual(hdrArtifact.outputEncoding, 'scene_linear_half_float', 'HDR output encoding');

const roundtrippedHdrArtifacts = SidecarSchema.parse(
  JSON.parse(JSON.stringify(hdr.metadata, null, 2)),
).rawEngineArtifacts;
assertJsonEqual(roundtrippedHdrArtifacts, hdrArtifacts, 'HDR artifact sidecar roundtrip');

const panoramaArtifacts = RawEngineArtifactsSchema.parse(panorama.metadata.rawEngineArtifacts);
assertEqual(panoramaArtifacts.schemaVersion, 1, 'rawEngineArtifacts schema version');
assertEqual(panoramaArtifacts.panoramaArtifacts.length, 1, 'panorama artifact count');
assertEqual(panoramaArtifacts.staleArtifactIds.length, 0, 'panorama stale artifact count');

const [panoramaArtifact] = panoramaArtifacts.panoramaArtifacts;
assertEqual(panoramaArtifact.provenance.runtimeStatus, 'rendered', 'panorama artifact runtime status');
assertEqual(panoramaArtifact.outputArtifacts.length, 1, 'panorama output artifact count');

const roundtrippedPanoramaArtifacts = SidecarSchema.parse(
  JSON.parse(JSON.stringify(panorama.metadata, null, 2)),
).rawEngineArtifacts;
assertJsonEqual(roundtrippedPanoramaArtifacts, panoramaArtifacts, 'panorama artifact sidecar roundtrip');

const missing = loadSidecarFixture(undefined);
if (!missing.usedDefault) {
  fail('missing sidecar should use default metadata');
}
assertJsonEqual(missing.metadata, DEFAULT_METADATA, 'missing sidecar default metadata');

const invalidJson = loadSidecarFixture('{');
if (!invalidJson.usedDefault) {
  fail('invalid JSON sidecar should use default metadata');
}
assertJsonEqual(invalidJson.metadata, DEFAULT_METADATA, 'invalid JSON sidecar default metadata');

const invalidShape = loadSidecarFixture('{"version":"1","rating":0,"adjustments":null}');
if (!invalidShape.usedDefault) {
  fail('structurally invalid sidecar should use default metadata');
}
assertJsonEqual(invalidShape.metadata, DEFAULT_METADATA, 'invalid shape default metadata');

console.log(
  [
    'Sidecar roundtrip fixture validation passed.',
    `Checked ${toRepoPath(toAbsolutePath(primaryFixturePath))}`,
    `Checked ${toRepoPath(toAbsolutePath(hdrFixturePath))}`,
    `Checked ${toRepoPath(toAbsolutePath(panoramaFixturePath))}`,
    `Checked ${toRepoPath(toAbsolutePath(virtualFixturePath))}`,
    'Coverage: schema shape, virtual-copy naming, adjustment preservation, tag conventions, HDR/panorama artifacts, missing/invalid defaults.',
  ].join('\n'),
);
