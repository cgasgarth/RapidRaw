import { readFileSync } from 'node:fs';

const observations = readFileSync('src-tauri/src/merge/super_resolution/cfa_observations.rs', 'utf8');
const intake = readFileSync('src-tauri/src/merge/super_resolution/raw_frame.rs', 'utf8');

for (const cfaClass of ['R', 'G1', 'G2', 'B']) {
  if (!intake.includes(cfaClass)) throw new Error(`Calibrated intake does not retain ${cfaClass}`);
}
for (const field of ['sensor_x', 'sensor_y', 'source_index', 'scene_x', 'scene_y', 'variance', 'confidence']) {
  if (!observations.includes(`pub ${field}:`)) throw new Error(`Observation provenance omits ${field}`);
}
if (!observations.includes('rotation_degrees.to_radians()')) {
  throw new Error('Observation mapping must consume continuous accepted SE(2) rotation.');
}
if (observations.includes('rem_euclid') || observations.includes('% frame.sensor.width')) {
  throw new Error('Observation mapping must not wrap sensor coordinates.');
}

console.log('super-resolution CFA phase provenance contract: ok');
