#!/usr/bin/env bun

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunOptions, runValidation } from '../../../scripts/validation/engine.ts';
import type { ValidationNode } from '../../../scripts/validation/manifest.ts';

const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-dag-'));
const lockRoot = await mkdtemp(join(tmpdir(), 'rapidraw-validation-locks-'));
await mkdir(join(root, 'src'), { recursive: true });
await writeFile(join(root, 'src/component.ts'), 'fixture\n');
const producer: ValidationNode = {
  id: 'shared-output-producer',
  command: ['sh', '-c', 'mkdir -p dist && sleep 0.05 && printf isolated > dist/artifact'],
  dependencies: [],
  inputs: ['frontend'],
  modes: ['commit'],
  outputs: ['dist'],
  resourceClass: 'light',
  cachePolicy: 'none',
  timeoutMs: 5000,
};
const options = (): RunOptions => ({
  changedPaths: ['src/component.ts'],
  explainCache: false,
  mode: 'commit',
  noCache: true,
  resourceCoordinatorRoot: lockRoot,
  root,
  verifyCache: false,
});
const results = await Promise.all([runValidation([producer], options()), runValidation([producer], options())]);
if (results.some((result) => result !== 0)) throw new Error(`concurrent validation failed: ${results.join(',')}`);
if ((await readFile(join(root, 'dist/artifact'), 'utf8')) !== 'isolated')
  throw new Error('producer output was corrupted');

const boundedCache = await mkdtemp(join(tmpdir(), 'rapidraw-validation-cache-'));
process.env.RAWENGINE_VALIDATION_CACHE_ROOT = boundedCache;
process.env.RAWENGINE_VALIDATION_CACHE_MAX_ENTRIES = '1';
const cached = { ...producer, cachePolicy: 'local' as const, outputs: undefined };
if ((await runValidation([{ ...cached, id: 'cache-a' }], options())) !== 0)
  throw new Error('cache-a validation failed');
if ((await runValidation([{ ...cached, id: 'cache-b' }], options())) !== 0)
  throw new Error('cache-b validation failed');
const cacheEntries = await readdir(boundedCache);
if (cacheEntries.filter((entry) => entry.endsWith('.json')).length > 1)
  throw new Error('cache entry bound was not enforced');

await rm(root, { recursive: true, force: true });
await rm(lockRoot, { recursive: true, force: true });
await rm(boundedCache, { recursive: true, force: true });
console.log('validation DAG isolation ok (concurrent producers + bounded cache)');
