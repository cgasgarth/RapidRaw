#!/usr/bin/env bun

import { access, readFile } from 'node:fs/promises';
import { z } from 'zod';

const STATUS_PATH = 'docs/validation/layer-runtime-parent-status-2026-06-18.json';
const PACKAGE_PATH = 'package.json';

const runtimeProofSchema = z
  .object({
    command: z.string().trim().startsWith('check:layer-'),
    fixture: z.string().trim().startsWith('fixtures/layers/'),
    issue: z.number().int().positive(),
    proof: z.string().trim().min(1),
  })
  .strict();

const statusSchema = z
  .object({
    explicitFollowUps: z.array(
      z
        .object({
          issue: z.number().int().positive(),
          reason: z.string().trim().min(1),
        })
        .strict(),
    ),
    parentIssue: z.literal(1248),
    runtimeProofs: z.array(runtimeProofSchema).min(5),
    status: z.literal('runtime_children_complete'),
    version: z.literal(1),
  })
  .strict();

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()),
});

const status = statusSchema.parse(JSON.parse(await readFile(STATUS_PATH, 'utf8')));
const packageJson = packageSchema.parse(JSON.parse(await readFile(PACKAGE_PATH, 'utf8')));

const requiredIssues = new Set([1912, 1913, 1914, 1915, 1265]);
const coveredIssues = new Set(status.runtimeProofs.map((proof) => proof.issue));
for (const issue of requiredIssues) {
  if (!coveredIssues.has(issue)) {
    throw new Error(`Missing layer runtime proof for #${issue}.`);
  }
}

for (const proof of status.runtimeProofs) {
  if (!(proof.command in packageJson.scripts)) {
    throw new Error(`${proof.command} is missing from package.json.`);
  }
  await access(proof.fixture);
}

if (!status.explicitFollowUps.some((followUp) => followUp.issue === 1247)) {
  throw new Error('Layer runtime parent status must preserve #1247 as a follow-up.');
}

console.log(`layer runtime parent status ok (${status.runtimeProofs.length} proofs)`);
