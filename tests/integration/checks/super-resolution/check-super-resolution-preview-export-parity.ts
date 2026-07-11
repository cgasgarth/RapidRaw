import { readFile } from 'node:fs/promises';

const [apply, artifact] = await Promise.all([
  readFile('src-tauri/src/merge/super_resolution/apply.rs', 'utf8'),
  readFile('src-tauri/src/merge/super_resolution/artifact.rs', 'utf8'),
]);

if (!artifact.includes('DynamicImage::ImageRgb32F(image.clone()).to_rgb16()'))
  throw new Error('Durable editor payload is not generated from committed scene-linear float tiles.');
if (!apply.includes('originalSourcesRequiredForExport": false'))
  throw new Error('Committed payload is not declared self-contained for export.');
if (!apply.includes('payload_path: "payload.tiff"'))
  throw new Error('Normal editor/export payload is not manifest-rooted.');

console.log('Burst SR committed preview/export path contract passed.');
