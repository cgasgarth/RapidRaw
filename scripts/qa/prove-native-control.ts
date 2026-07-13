#!/usr/bin/env bun

import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { readLiveNativeQaControlRecord, requestNativeQaControl } from './native-control';

const args = process.argv.slice(2);
const optionValue = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const fixture = optionValue('--fixture');
if (fixture === undefined || !isAbsolute(fixture)) throw new Error('--fixture must be an absolute image path.');
const recordPath = resolve(optionValue('--record') ?? 'private-artifacts/qa/native-control.json');
const record = await readLiveNativeQaControlRecord(recordPath, process.cwd());
if (record === undefined) throw new Error(`Native QA control record is unavailable: ${recordPath}`);

const resultSchema = z.object({
  ready: z.boolean(),
  identity: z.object({ worktree: z.string(), build: z.string() }),
  capabilities: z.object({
    protocolVersion: z.literal(1),
    health: z.literal(true),
    reset: z.literal(true),
    openFixture: z.literal(true),
    revisionDiagnostics: z.literal(true),
    screenshot: z.boolean(),
    cleanShutdown: z.literal(true),
    coldWarmMode: z.literal(true),
  }),
});
const timings: Record<string, number[]> = {};
const required = async (method: string, parameters: Readonly<Record<string, unknown>> = {}) => {
  const started = performance.now();
  const response = await requestNativeQaControl(record, method, parameters);
  (timings[method] ??= []).push(Math.round(performance.now() - started));
  if (!response.ok) throw new Error(`${method} failed: ${response.error ?? 'unknown error'}`);
  return response.result;
};

let health: z.infer<typeof resultSchema> | undefined;
for (let attempt = 0; attempt < 200; attempt += 1) {
  const response = await requestNativeQaControl(record, 'health').catch(() => undefined);
  if (response?.ok) {
    health = resultSchema.parse(response.result);
    if (health.ready) break;
  }
  await Bun.sleep(50);
}
if (health === undefined || !health.ready) throw new Error('Native QA app did not report frontend readiness.');
if (health.identity.worktree !== record.identity.worktree || health.identity.build !== record.identity.build)
  throw new Error('Native QA health identity does not match the launcher record.');

const unauthorized = await requestNativeQaControl(record, 'health', {}, 'wrong-token');
if (unauthorized.ok || !unauthorized.error?.includes('authentication'))
  throw new Error('Wrong control token was accepted.');
const mismatched = await requestNativeQaControl(
  { ...record, identity: { ...record.identity, build: 'wrong-build' } },
  'health',
);
if (mismatched.ok || !mismatched.error?.includes('identity mismatch'))
  throw new Error('Wrong build identity was accepted.');

await required('reset', { mode: 'empty' });
z.object({ activeNativeSource: z.null(), sourcePath: z.null() }).parse(await required('diagnostics'));
const opened = z
  .object({ path: z.string(), sessionRevision: z.number().int().positive() })
  .parse(await required('openFixture', { path: resolve(fixture) }));
const diagnosticsSchema = z.object({
  activeNativeSource: z.string().nullable(),
  cacheMode: z.enum(['cold', 'warm']),
  sourcePath: z.string(),
  sessionRevision: z.number(),
  renderRevision: z.number(),
  preview: z
    .object({
      source: z.string(),
      imageSession: z.number(),
      adjustmentRevision: z.number(),
      planRevision: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
      completedStage: z.string().min(1),
      backendGeneration: z.number(),
    })
    .nullable(),
});
let openedDiagnostics: z.infer<typeof diagnosticsSchema> | undefined;
for (let attempt = 0; attempt < 400; attempt += 1) {
  openedDiagnostics = diagnosticsSchema.parse(await required('diagnostics'));
  if (openedDiagnostics.activeNativeSource === opened.path && openedDiagnostics.preview !== null) break;
  await Bun.sleep(50);
}
if (openedDiagnostics?.activeNativeSource !== opened.path || openedDiagnostics.preview === null)
  throw new Error('Native QA app did not make the requested fixture and preview render-authoritative.');

const screenshotPath = resolve('private-artifacts/qa/native-control-proof.png');
await rm(screenshotPath, { force: true });
if (health.capabilities.screenshot) {
  const screenshot = z
    .object({ path: z.string(), bytes: z.number().positive() })
    .parse(await required('screenshot', { path: screenshotPath }));
  const header = await readFile(screenshot.path).then((bytes) => bytes.subarray(0, 8).toString('hex'));
  if (header !== '89504e470d0a1a0a' || (await stat(screenshot.path)).size !== screenshot.bytes)
    throw new Error('Native QA screenshot is not a valid nonempty PNG artifact.');
}
await required('setCacheMode', { mode: 'cold' });
const cold = diagnosticsSchema.extend({ cacheMode: z.literal('cold') }).parse(await required('diagnostics'));
await required('setCacheMode', { mode: 'warm' });
const warm = diagnosticsSchema.extend({ cacheMode: z.literal('warm') }).parse(await required('diagnostics'));
if (cold.sourcePath !== opened.path || warm.sourcePath !== opened.path || warm.renderRevision <= 0)
  throw new Error('Native QA revision/source diagnostics did not follow the fixture session.');
await required('reset', { mode: 'library' });
const libraryDiagnostics = diagnosticsSchema.parse(await required('diagnostics'));
if (libraryDiagnostics.activeNativeSource !== null || libraryDiagnostics.sourcePath !== opened.path)
  throw new Error('Library reset did not clear the native active render while retaining the fixture session.');
await required('reset', { mode: 'editor' });
let editorDiagnostics: z.infer<typeof diagnosticsSchema> | undefined;
for (let attempt = 0; attempt < 400; attempt += 1) {
  editorDiagnostics = diagnosticsSchema.parse(await required('diagnostics'));
  if (editorDiagnostics.activeNativeSource === opened.path && editorDiagnostics.preview !== null) break;
  await Bun.sleep(50);
}
if (editorDiagnostics?.activeNativeSource !== opened.path || editorDiagnostics.preview === null)
  throw new Error('Editor reset did not reopen the retained fixture into an authoritative preview.');
await required('shutdown');
for (let attempt = 0; attempt < 200; attempt += 1) {
  const alive = Bun.spawnSync(['kill', '-0', String(record.pid)]).exitCode === 0;
  const socketExists = (await stat(record.socketPath).catch(() => undefined)) !== undefined;
  if (!alive && !socketExists) break;
  await Bun.sleep(25);
  if (attempt === 199) throw new Error('Native QA clean shutdown left its process or control socket alive.');
}

const proof = {
  identity: record.identity,
  fixture: opened.path,
  sessionRevision: cold.sessionRevision,
  renderRevision: warm.renderRevision,
  screenshot: health.capabilities.screenshot ? screenshotPath : null,
  authenticated: true,
  productionBoundary: 'validation-harness feature only',
  timingsMs: timings,
};
const proofPath = resolve('private-artifacts/qa/native-control-proof.json');
await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify({ ...proof, proofPath }));
