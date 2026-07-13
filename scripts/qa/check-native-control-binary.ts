#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { NATIVE_QA_BINARY_MARKERS, verifyNativeQaBinaryBoundary } from './native-control';

const args = process.argv.slice(2);
const binary = args[args.indexOf('--binary') + 1];
const expectation = args[args.indexOf('--expect') + 1];
if (binary === undefined || (expectation !== 'present' && expectation !== 'absent'))
  throw new Error('Usage: check-native-control-binary.ts --binary PATH --expect present|absent');
const contents = await readFile(binary);
verifyNativeQaBinaryBoundary(contents, expectation);
console.log(`native QA binary boundary ok (${expectation}; ${NATIVE_QA_BINARY_MARKERS.length} markers)`);
