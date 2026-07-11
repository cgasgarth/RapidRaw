#!/usr/bin/env bun
import { readFileSync } from 'node:fs';

const candidate = readFileSync('src-tauri/src/merge/focus_stack/candidate.rs', 'utf8');
const job = readFileSync('src-tauri/src/merge/focus_stack/job.rs', 'utf8');
for (const token of ['StagingGuard', 'checkpoint(token', 'computational_merge_cancelled', 'candidate: None'])
  if (!(candidate + job).includes(token)) throw new Error(`missing cancellation cleanup: ${token}`);
console.log('focus cancellation cleanup wiring ok');
