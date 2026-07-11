#!/usr/bin/env bun
import { readFileSync } from 'node:fs';

const runtime = readFileSync('src-tauri/src/merge/focus_stack/runtime.rs', 'utf8');
const candidate = readFileSync('src-tauri/src/merge/focus_stack/candidate.rs', 'utf8');
for (const token of [
  'transform_hash',
  'policy_hash',
  'preview_hash',
  'source_hashes',
  'graph_revisions',
  'source_order',
])
  if (!(runtime.includes(token) && candidate.includes(token))) throw new Error(`accepted identity missing ${token}`);
console.log('focus preview/candidate identity parity wiring ok');
