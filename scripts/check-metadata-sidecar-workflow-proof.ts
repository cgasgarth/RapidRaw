#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

const metadataSidecarSchema = z
  .object({
    adjustments: z.unknown().nullable(),
    metadataWorkflow: z
      .object({
        appliedAt: z.iso.datetime(),
        editId: z.string().trim().min(1),
        sourceContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      })
      .strict()
      .optional(),
    rating: z.number().int().min(0).max(5),
    tags: z.array(z.string().trim().min(1)),
    version: z.literal(1),
  })
  .strict()
  .superRefine((sidecar, context) => {
    const colorTags = sidecar.tags.filter((tag) => tag.startsWith('color:'));
    if (colorTags.length > 1) {
      context.addIssue({ code: 'custom', message: 'Only one color label tag is allowed.', path: ['tags'] });
    }
    if (sidecar.tags.join('\n') !== [...new Set(sidecar.tags)].sort((a, b) => a.localeCompare(b)).join('\n')) {
      context.addIssue({ code: 'custom', message: 'Metadata tags must be sorted and deduplicated.', path: ['tags'] });
    }
  });

const metadataEditSchema = z
  .object({
    colorLabel: z.enum(['red', 'yellow', 'green', 'blue', 'purple']).nullable(),
    editId: z.string().trim().min(1),
    rating: z.number().int().min(0).max(5),
    userTags: z.array(z.string().trim().min(1)),
  })
  .strict();

type MetadataSidecar = z.infer<typeof metadataSidecarSchema>;

const tempDir = await mkdtemp(join(tmpdir(), 'rawengine-metadata-sidecar-'));
const sourceRawPath = join(tempDir, 'IMG_METADATA_0001.CR3');
const sidecarPath = `${sourceRawPath}.rrdata`;

try {
  await writeFile(sourceRawPath, 'synthetic raw bytes must never change\n');
  const sourceBefore = await hashFile(sourceRawPath);
  await writeFile(
    sidecarPath,
    JSON.stringify(
      metadataSidecarSchema.parse({
        adjustments: null,
        rating: 1,
        tags: ['user:draft'],
        version: 1,
      }),
      null,
      2,
    ),
  );

  const applied = applyMetadataEdit(await loadSidecar(sidecarPath), sourceBefore, {
    colorLabel: 'green',
    editId: 'metadata_edit_rating_label_tags_v1',
    rating: 5,
    userTags: ['portfolio', 'client-select', 'portfolio'],
  });
  await writeFile(sidecarPath, `${JSON.stringify(applied, null, 2)}\n`);

  const reloaded = await loadSidecar(sidecarPath);
  if (reloaded.rating !== 5) throw new Error('Metadata rating did not persist.');
  assertArrayEqual(reloaded.tags, ['color:green', 'user:client-select', 'user:portfolio'], 'persisted tags');
  if (reloaded.metadataWorkflow?.sourceContentHash !== sourceBefore) {
    throw new Error('Metadata workflow did not preserve source RAW hash provenance.');
  }
  if ((await hashFile(sourceRawPath)) !== sourceBefore) {
    throw new Error('Metadata sidecar workflow mutated the source RAW bytes.');
  }

  expectThrows('duplicate color label', () =>
    metadataSidecarSchema.parse({ ...reloaded, tags: ['color:blue', 'color:green', 'user:portfolio'] }),
  );

  console.log(`metadata sidecar workflow ok (${reloaded.rating}, ${reloaded.tags.length} tags)`);
} finally {
  await rm(tempDir, { force: true, recursive: true });
}

async function loadSidecar(path: string): Promise<MetadataSidecar> {
  return metadataSidecarSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

function applyMetadataEdit(sidecar: MetadataSidecar, sourceContentHash: string, editValue: unknown): MetadataSidecar {
  const edit = metadataEditSchema.parse(editValue);
  const userTags = edit.userTags.map((tag) => `user:${tag.replace(/^user:/u, '')}`);
  const colorTags = edit.colorLabel === null ? [] : [`color:${edit.colorLabel}`];
  return metadataSidecarSchema.parse({
    ...sidecar,
    metadataWorkflow: {
      appliedAt: '2026-06-18T00:00:00.000Z',
      editId: edit.editId,
      sourceContentHash,
    },
    rating: edit.rating,
    tags: [...new Set([...colorTags, ...userTags])].sort((a, b) => a.localeCompare(b)),
  });
}

async function hashFile(path: string): Promise<string> {
  return `sha256:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;
}

function assertArrayEqual(actual: Array<string>, expected: Array<string>, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function expectThrows(label: string, callback: () => void): void {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
}
