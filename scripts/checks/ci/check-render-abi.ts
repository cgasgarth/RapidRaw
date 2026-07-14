#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const manifestPath = 'src-tauri/render-abi/render-abi.toml';
const manifest = read(manifestPath);
const rustBindings = read('src-tauri/src/gpu/generated_bindings.rs');
const wgslBindings = read('src-tauri/src/shaders/generated_bindings.wgsl');
const rustGpu = read('src-tauri/src/gpu/gpu_processing.rs');
const shader = read('src-tauri/src/shaders/shader.wgsl');
const rustAbi = read('src-tauri/src/adjustments/abi.rs');
const wgslAbi = shader;

const number = (key: string) => {
  const match = manifest.match(new RegExp(`^${key}\\s*=\\s*(\\d+)\\s*$`, 'mu'));
  if (!match) throw new Error(`render ABI manifest is missing ${key}`);
  return Number(match[1]);
};
const bindingKeys = [
  'input_texture',
  'output_texture',
  'adjustments',
  'mask_textures',
  'lut_texture',
  'lut_sampler',
  'sharpness_blur',
  'tonal_blur',
  'clarity_blur',
  'structure_blur',
  'dehaze_blur',
  'flare_texture',
  'flare_sampler',
] as const;
const rustNames = [
  'MAIN_BINDING_INPUT_TEXTURE',
  'MAIN_BINDING_OUTPUT_TEXTURE',
  'MAIN_BINDING_ADJUSTMENTS',
  'MAIN_BINDING_MASK_TEXTURES',
  'MAIN_BINDING_LUT_TEXTURE',
  'MAIN_BINDING_LUT_SAMPLER',
  'MAIN_BINDING_SHARPNESS_BLUR',
  'MAIN_BINDING_TONAL_BLUR',
  'MAIN_BINDING_CLARITY_BLUR',
  'MAIN_BINDING_STRUCTURE_BLUR',
  'MAIN_BINDING_DEHAZE_BLUR',
  'MAIN_BINDING_FLARE_TEXTURE',
  'MAIN_BINDING_FLARE_SAMPLER',
] as const;
const wgslNames = rustNames;
const failures: string[] = [];
const expect = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};

expect(number('schema_version') === 1, 'unsupported render ABI schema version');
expect(
  number('layout_version') === Number(rustBindings.match(/RENDER_ABI_LAYOUT_VERSION: u32 = (\d+)/)?.[1]),
  'Rust layout version drift',
);
expect(
  number('max_mask_bindings') === Number(rustBindings.match(/MAX_MASK_BINDINGS: u32 = (\d+)/)?.[1]),
  'Rust mask capacity drift',
);
for (let index = 0; index < bindingKeys.length; index += 1) {
  const value = number(bindingKeys[index]);
  const rust = rustBindings.match(new RegExp(`${rustNames[index]}: u32 = (\\d+)`))?.[1];
  const wgsl = wgslBindings.match(new RegExp(`${wgslNames[index]}: u32 = (\\d+)u`))?.[1];
  expect(rust === String(value), `${rustNames[index]} differs from manifest (${rust ?? '<missing'} != ${value})`);
  expect(wgsl === String(value), `${wgslNames[index]} differs from manifest (${wgsl ?? '<missing'} != ${value})`);
  expect(shader.includes(`@binding(${wgslNames[index]})`), `shader does not use generated ${wgslNames[index]}`);
  expect(rustGpu.includes(rustNames[index]), `Rust GPU path does not use generated ${rustNames[index]}`);
}

const fields = manifest
  .match(/fields\s*=\s*\[([^\]]+)\]/)?.[1]
  ?.split(',')
  .map((field) => field.trim().replace(/^"|"$/gu, ''))
  .filter(Boolean);
expect(fields !== undefined && fields.length > 0, 'AllAdjustments field order is missing from manifest');
const structBody = (source: string, name: string) =>
  source.match(new RegExp(`(?:pub )?struct ${name} \\{([\\s\\S]*?)\\n\\}`, 'u'))?.[1] ?? '';
const sourceFields = (body: string) =>
  body
    .split(/\r?\n/u)
    .map((line) => line.trim().match(/(?:pub(?:\([^)]*\))? )?([A-Za-z0-9_]+):/)?.[1])
    .filter((field): field is string => field !== undefined);
const expectedFields = fields ?? [];
expect(
  JSON.stringify(sourceFields(structBody(rustAbi, 'AllAdjustments')).slice(0, expectedFields.length)) ===
    JSON.stringify(expectedFields),
  'Rust AllAdjustments field order differs from manifest',
);
expect(
  JSON.stringify(sourceFields(structBody(wgslAbi, 'AllAdjustments')).slice(0, expectedFields.length)) ===
    JSON.stringify(expectedFields),
  'WGSL AllAdjustments field order differs from manifest',
);

if (failures.length > 0) {
  console.error('Render ABI manifest check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `Render ABI manifest passed (${bindingKeys.length} main bindings, ${expectedFields.length} AllAdjustments fields).`,
);
