#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const RUST_SOURCE = 'src-tauri/src/adjustments/abi.rs';
const WGSL_SOURCE = 'src-tauri/src/shaders/shader.wgsl';

const rustSource = readFileSync(RUST_SOURCE, 'utf8');
const wgslSource = readFileSync(WGSL_SOURCE, 'utf8');

const STRUCTS = [
  'Point',
  'HslColor',
  'ColorGradeSettings',
  'ColorCalibrationSettings',
  'ChannelMixerRow',
  'ChannelMixerSettings',
  'BlackWhiteMixerSettings',
  'LevelsSettings',
  'ColorBalanceRgbSettings',
  'ToneEqualizerGpuSettings',
  'GlobalAdjustments',
  'MaskAdjustments',
  'AllAdjustments',
];

const NAME_ALIASES = new Map([['centré', 'centre']]);

const normalizeName = (name) => NAME_ALIASES.get(name) ?? name;

const parseRustMaxMasks = () => {
  const match = rustSource.match(/pub\s+const\s+MAX_MASKS\s*:\s*usize\s*=\s*(\d+)\s*;/u);
  if (!match) throw new Error('Missing Rust MAX_MASKS constant.');
  return match[1];
};

const MAX_MASKS = parseRustMaxMasks();

const extractRustStructBody = (structName) => {
  const match = rustSource.match(new RegExp(`pub\\s+struct\\s+${structName}\\s*\\{([\\s\\S]*?)\\n\\}`, 'u'));
  if (!match) throw new Error(`Missing Rust struct ${structName}.`);
  return match[1];
};

const extractWgslStructBody = (structName) => {
  const match = wgslSource.match(new RegExp(`struct\\s+${structName}\\s*\\{([\\s\\S]*?)\\n\\}`, 'u'));
  if (!match) throw new Error(`Missing WGSL struct ${structName}.`);
  return match[1];
};

const normalizeRustType = (type) => {
  const trimmed = type.trim();
  if (trimmed === 'GpuMat3') return 'mat3x3<f32>';
  if (trimmed === `[MaskAdjustments; MAX_MASKS]`) return `array<MaskAdjustments, ${MAX_MASKS}>`;

  const fixedArray = trimmed.match(/^\[([A-Za-z0-9_]+);\s*(\d+)\]$/u);
  if (fixedArray) {
    if (fixedArray[1] === 'f32' && fixedArray[2] === '4') return 'vec4<f32>';
    return `array<${fixedArray[1]}, ${fixedArray[2]}>`;
  }

  return trimmed;
};

const parseRustFields = (structName) =>
  extractRustStructBody(structName)
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/,$/u, ''))
    .filter(Boolean)
    .filter((line) => !line.startsWith('///'))
    .map((line) => line.replace(/^pub(?:\([^)]*\))?\s+/u, ''))
    .filter((line) => !line.startsWith('#['))
    .filter((line) => !line.startsWith('_pad_wgsl_'))
    .map((line) => {
      const match = line.match(/^([A-Za-z0-9_é]+)\s*:\s*(.+)$/u);
      if (!match) throw new Error(`Unable to parse Rust field in ${structName}: ${line}`);
      return { name: normalizeName(match[1]), type: normalizeRustType(match[2]) };
    });

const parseWgslFields = (structName) =>
  extractWgslStructBody(structName)
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/,$/u, ''))
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.+)$/u);
      if (!match) throw new Error(`Unable to parse WGSL field in ${structName}: ${line}`);
      return { name: match[1], type: match[2].trim() };
    });

const formatField = (field) => `${field.name}: ${field.type}`;

const failures = [];

for (const structName of STRUCTS) {
  const rustFields = parseRustFields(structName);
  const wgslFields = parseWgslFields(structName);

  if (rustFields.length !== wgslFields.length) {
    failures.push(`${structName}: Rust has ${rustFields.length} fields; WGSL has ${wgslFields.length}.`);
  }

  const maxLength = Math.max(rustFields.length, wgslFields.length);
  for (let index = 0; index < maxLength; index += 1) {
    const rustField = rustFields[index];
    const wgslField = wgslFields[index];

    if (rustField === undefined || wgslField === undefined) {
      failures.push(
        `${structName}[${index}]: missing counterpart Rust=${rustField ? formatField(rustField) : '<missing>'} WGSL=${
          wgslField ? formatField(wgslField) : '<missing>'
        }`,
      );
      continue;
    }

    if (rustField.name !== wgslField.name || rustField.type !== wgslField.type) {
      failures.push(
        `${structName}[${index}]: Rust ${formatField(rustField)} does not match WGSL ${formatField(wgslField)}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('Color adjustment ABI parity failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Color adjustment ABI parity passed for ${STRUCTS.length} Rust/WGSL structs.`);
