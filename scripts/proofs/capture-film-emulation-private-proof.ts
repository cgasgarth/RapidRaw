#!/usr/bin/env bun

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { filmRuntimeProofReceiptV1Schema } from '../../packages/rawengine-schema/src/index.ts';

const requireAssets = Bun.argv.includes('--require-assets');
const sourceRoot = process.env.RAWENGINE_PRIVATE_RAW_SOURCE;
const proofRoot = process.env.RAWENGINE_FILM_PRIVATE_PROOF_ROOT ?? '/tmp/rawengine-film-emulation-private-proof';
const receiptPath = valueAfter('--receipt');

if (sourceRoot === undefined || sourceRoot.trim().length === 0) {
  if (requireAssets) throw new Error('RAWENGINE_PRIVATE_RAW_SOURCE is required with --require-assets.');
  console.log(
    JSON.stringify({
      proofLevel: 'native_private_raw_preview_export',
      status: 'skipped',
      reason: 'private_assets_missing',
    }),
  );
  process.exit(0);
}
if (receiptPath === undefined) {
  if (requireAssets)
    throw new Error('A production native receipt is required with --receipt when --require-assets is set.');
  console.log(
    JSON.stringify({
      proofLevel: 'native_private_raw_preview_export',
      status: 'skipped',
      reason: 'native_receipt_missing',
    }),
  );
  process.exit(0);
}

const sourcePath = await findFirstRaw(sourceRoot);
if (sourcePath === undefined) throw new Error('No RAW source found under RAWENGINE_PRIVATE_RAW_SOURCE.');
const sourceHash = await sha256File(sourcePath);
const receipt = filmRuntimeProofReceiptV1Schema.parse(JSON.parse(await readFile(receiptPath, 'utf8')));
if (receipt.sourceContentSha256 !== sourceHash)
  throw new Error('Native receipt source hash does not match the selected private RAW.');
if (receipt.previewExportMetrics.sourceHashUnchanged !== true)
  throw new Error('Native receipt reports a changed source hash.');

await mkdir(proofRoot, { recursive: true });
await writeFile(
  join(proofRoot, 'film-runtime-proof-summary.json'),
  `${JSON.stringify({ ...receipt, sourceContentSha256: sourceHash }, null, 2)}\n`,
  'utf8',
);
console.log(
  JSON.stringify({
    proofLevel: receipt.proofLevel,
    status: 'passed',
    receiptHash: await sha256Text(JSON.stringify(receipt)),
  }),
);

async function findFirstRaw(root: string): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFirstRaw(path);
      if (nested !== undefined) return nested;
    } else if (/\.(?:arw|cr2|cr3|dng|nef|orf|raf|rw2|sr2|srf)$/iu.test(entry.name)) {
      return path;
    }
  }
  return undefined;
}

async function sha256File(path: string): Promise<`sha256:${string}`> {
  return sha256Text(await Bun.file(path).arrayBuffer());
}

async function sha256Text(value: string | ArrayBuffer): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    typeof value === 'string' ? new TextEncoder().encode(value) : value,
  );
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function valueAfter(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}
