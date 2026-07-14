#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const workflow = await readFile('.github/workflows/main-long-validation.yml', 'utf8');
const stableName = 'main-native-startup-${{ github.run_id }}';
if (!workflow.includes(`name: ${stableName}`))
  throw new Error('startup producer/consumer artifact identity is not run-stable');
if (workflow.includes('main-native-startup-${{ github.run_id }}-${{ github.run_attempt }}')) {
  throw new Error('startup artifact identity still changes on job rerun');
}
if (!workflow.includes('github.run_attempt == 1'))
  throw new Error('producer upload is not protected from immutable rerun conflict');
if (!workflow.includes('Diagnose missing immutable startup artifact'))
  throw new Error('missing-artifact diagnostics are absent');
if (!workflow.includes('producer_attempt=1')) throw new Error('missing-artifact diagnostics omit producer attempt');

console.log('main-long native startup artifact contract ok (stable identity + rerun diagnostic)');
