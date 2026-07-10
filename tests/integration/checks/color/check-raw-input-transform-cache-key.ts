import { readFile } from 'node:fs/promises';

const source = await readFile('src-tauri/src/io/image_loader.rs', 'utf8');
for (const identity of [
  'source-content-blake3',
  'raw-processing-mode',
  'highlight-compression',
  'camera-profile-resolver',
  'raw-decoder=rawler-0.7.1',
  'input-transform',
  'xyz-to-ap1',
  'numeric-policy',
]) {
  if (!source.includes(identity)) throw new Error(`RAW input cache identity missing ${identity}`);
}
for (const downstream of ['display-profile', 'output-icc', 'colorsync']) {
  const cacheFormat = source.slice(
    source.indexOf('pub(crate) fn raw_processing_mode_cache_key'),
    source.indexOf('#[derive(Deserialize)]'),
  );
  if (cacheFormat.includes(downstream))
    throw new Error(`Downstream identity ${downstream} must not invalidate RAW AP1.`);
}
console.log('raw input-transform cache identity ok');
