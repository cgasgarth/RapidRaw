#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';

import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

const MANIFEST_PATH = 'docs/api/surface-coverage/ui-edit-surface-coverage-2026-06-16.json';
const args = new Set(process.argv.slice(2));
const shouldUpdate = args.has('--update');

const mappedSurfaceSchema = z
  .object({
    appServerTool: z.string().trim().min(1),
    commandSchema: z.string().trim().min(1),
    coverageLevel: z.literal('mapped'),
    surface: z.string().trim().min(1),
    uiFiles: z.array(z.string().trim().min(1)).min(1),
    validation: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

const readOnlySurfaceSchema = z
  .object({
    appServerTool: z.string().trim().min(1),
    commandSchema: z.string().trim().min(1),
    coverageLevel: z.literal('read_only'),
    surface: z.string().trim().min(1),
    uiFiles: z.array(z.string().trim().min(1)).min(1),
    validation: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

const runtimeApplySurfaceSchema = z
  .object({
    appServerTool: z.string().trim().min(1),
    commandSchema: z.string().trim().min(1),
    coverageLevel: z.literal('runtime_apply_capable'),
    e2eIssues: z
      .array(
        z
          .string()
          .trim()
          .regex(/^#[1-9][0-9]*$/u),
      )
      .min(1),
    surface: z.string().trim().min(1),
    uiFiles: z.array(z.string().trim().min(1)).min(1),
    validation: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

const deferredSurfaceSchema = z
  .object({
    coverageLevel: z.literal('deferred'),
    deferredIssue: z
      .string()
      .trim()
      .regex(/^#[1-9][0-9]*$/u),
    deferredReason: z.string().trim().min(20),
    surface: z.string().trim().min(1),
    uiFiles: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

const manifestSchema = z
  .object({
    generatedMarkdownPath: z.string().trim().min(1),
    schemaVersion: z.literal(1),
    surfaces: z
      .array(
        z.discriminatedUnion('coverageLevel', [
          mappedSurfaceSchema,
          readOnlySurfaceSchema,
          runtimeApplySurfaceSchema,
          deferredSurfaceSchema,
        ]),
      )
      .min(1),
  })
  .strict();

const manifest = manifestSchema.parse(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));

const mappedCount = manifest.surfaces.filter((surface) => surface.coverageLevel === 'mapped').length;
const runtimeApplyCount = manifest.surfaces.filter(
  (surface) => surface.coverageLevel === 'runtime_apply_capable',
).length;
const deferredCount = manifest.surfaces.filter((surface) => surface.coverageLevel === 'deferred').length;

const escapeCell = (value) => value.replaceAll('|', '\\|');

const rows = manifest.surfaces
  .map((surface) => {
    const uiFiles = surface.uiFiles.map((file) => `\`${file}\``).join('<br>');

    if (surface.coverageLevel === 'deferred') {
      return `| ${escapeCell(surface.surface)} | deferred | ${uiFiles} | ${surface.deferredIssue}: ${escapeCell(surface.deferredReason)} | | |`;
    }

    const validation = surface.validation.map((check) => `\`${check}\``).join('<br>');
    const e2eIssues =
      surface.coverageLevel === 'runtime_apply_capable' ? `<br>E2E follow-ups: ${surface.e2eIssues.join(', ')}` : '';
    return `| ${escapeCell(surface.surface)} | ${surface.coverageLevel} | ${uiFiles} | \`${escapeCell(surface.commandSchema)}\`${e2eIssues} | \`${escapeCell(surface.appServerTool)}\` | ${validation} |`;
  })
  .join('\n');

const markdown = `# UI Edit Surface API Coverage

Generated from \`${MANIFEST_PATH}\`.

Mapped surfaces: ${mappedCount}

Runtime apply-capable surfaces: ${runtimeApplyCount}

Deferred surfaces with explicit issue owners: ${deferredCount}

| Surface | Status | UI files | Command schema / deferral | App-server tool | Validation |
| --- | --- | --- | --- | --- | --- |
${rows}
`;

const prettierConfig = (await resolveConfig(manifest.generatedMarkdownPath)) ?? {};
const formattedMarkdown = await format(markdown, { ...prettierConfig, filepath: manifest.generatedMarkdownPath });

if (shouldUpdate) {
  writeFileSync(manifest.generatedMarkdownPath, formattedMarkdown);
  console.log('ui api coverage updated');
  process.exit(0);
}

const currentMarkdown = readFileSync(manifest.generatedMarkdownPath, 'utf8');
if (currentMarkdown !== formattedMarkdown) {
  throw new Error(
    `${manifest.generatedMarkdownPath} is stale. Run bun tests/integration/checks/check-ui-api-coverage.ts --update`,
  );
}

console.log('ui api coverage ok');
