#!/usr/bin/env bun
import { readFileSync } from 'node:fs';

const candidate = readFileSync('src-tauri/src/merge/focus_stack/candidate.rs', 'utf8');
const tiles = readFileSync('src-tauri/src/merge/focus_stack/tiles.rs', 'utf8');
for (const token of ['plan_tiles', 'influence_halo', 'safety_margin_bytes', 'memory_budget_bytes'])
  if (!(tiles + candidate).includes(token)) throw new Error(`missing bounded tile runtime: ${token}`);
for (const token of ['rgb', 'maps', 'manifest.json', 'receipt.json', 'commitReady', 'validate(&staging'])
  if (!candidate.includes(token)) throw new Error(`missing candidate package behavior: ${token}`);
console.log('focus tiled native runtime wiring ok');
