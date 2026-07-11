#!/usr/bin/env bun
import { readFileSync } from 'node:fs';

const blend = readFileSync('src-tauri/src/merge/focus_stack/blend.rs', 'utf8');
const pyramid = readFileSync('src-tauri/src/merge/focus_stack/pyramid.rs', 'utf8');
const runtime = readFileSync('src-tauri/src/merge/focus_stack/runtime.rs', 'utf8');
for (const token of ['pyramid::laplacian', 'pyramid::reconstruct', 'source.rgb', 'fallback_required', 'occlusion_risk'])
  if (!blend.includes(token)) throw new Error(`native blend missing ${token}`);
for (const token of ['focus_binomial_pyramid_v1', 'KERNEL', 'clamp(5, 8)', 'focus_stack_blend_checkerboard'])
  if (!pyramid.includes(token)) throw new Error(`pyramid missing ${token}`);
if (!runtime.includes('native_blend') || !runtime.includes('blend::fuse'))
  throw new Error('accepted plan does not publish native fusion');
console.log('native full-color Laplacian fusion wiring ok');
