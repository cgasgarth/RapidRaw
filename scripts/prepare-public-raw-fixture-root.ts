#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

const DEFAULT_PRIVATE_ROOT = '/tmp/rawengine-private-root';
const RAW_PIXLS_DOWNLOAD_ROOT = 'https://raw.pixls.us/download/data';
const RAW_PIXLS_SOURCE_PAGE = 'https://raw.pixls.us/';
const RAW_PIXLS_LICENSE_NOTE =
  'raw.pixls.us upload declaration releases submitted files into the public domain; this script stores local validation copies only.';

const fixtureFamilySchema = z.enum(['focus_stack', 'panorama_stitch', 'super_resolution']);
type FixtureFamily = z.infer<typeof fixtureFamilySchema>;
type FixtureSuitability = 'format_smoke_only' | 'runtime_proof_candidate';

interface PublicRawFixtureSource {
  family: FixtureFamily;
  localPath: string;
  rawPixlsPath: string;
  sha256: string;
}

const fixtureFamilySuitability = {
  focus_stack: 'format_smoke_only',
  panorama_stitch: 'format_smoke_only',
  super_resolution: 'runtime_proof_candidate',
} as const satisfies Record<FixtureFamily, FixtureSuitability>;

const publicRawFixtureSources = [
  {
    family: 'focus_stack',
    localPath: 'private-fixtures/focus-stack/plane-transition-v1/frame-01.cr3',
    rawPixlsPath: 'Canon/EOS R7/443A0157.CR3',
    sha256: '887439cb1a45becd6a5c85fe75ae10e6c520a9f13a8b9ed077c6cf5d7c37700c',
  },
  {
    family: 'focus_stack',
    localPath: 'private-fixtures/focus-stack/plane-transition-v1/frame-02.cr3',
    rawPixlsPath: 'Canon/EOS R7/443A0159.CR3',
    sha256: '10a18e3f01ca9cd93408496d3853388ef140830548bfeed4237e40f967eb9d5c',
  },
  {
    family: 'focus_stack',
    localPath: 'private-fixtures/focus-stack/plane-transition-v1/frame-03.cr3',
    rawPixlsPath: 'Canon/EOS R7/443A0161.CR3',
    sha256: 'c01cee1b598120668370892c16a73da915f2aaec8169c5c60a96efd98d9aa220',
  },
  {
    family: 'super_resolution',
    localPath: 'private-fixtures/super-resolution/subpixel-detail-v1/frame-01.nef',
    rawPixlsPath: 'Nikon/D3/JD1_8203.NEF',
    sha256: '880c60c5f611adf6b70de3d099f8433492de3a3d96866d570122f17f0a651fc8',
  },
  {
    family: 'super_resolution',
    localPath: 'private-fixtures/super-resolution/subpixel-detail-v1/frame-02.nef',
    rawPixlsPath: 'Nikon/D3/JD1_8204.NEF',
    sha256: 'bd1efee38aab8daf79c199e076785125ece01eb8f5ef6741121b0f313ee4ac04',
  },
  {
    family: 'super_resolution',
    localPath: 'private-fixtures/super-resolution/subpixel-detail-v1/frame-03.nef',
    rawPixlsPath: 'Nikon/D3/JD1_8205.NEF',
    sha256: '6c4ca5ac7525c01c972f517503c47389f2f244c1fab2ad4ea9d10c63d36c42e6',
  },
  {
    family: 'super_resolution',
    localPath: 'private-fixtures/super-resolution/subpixel-detail-v1/frame-04.nef',
    rawPixlsPath: 'Nikon/D3/JD1_8206.NEF',
    sha256: '0626c09a58ca12ee4c12f919772abd4fd053c7d88c2f2b25e8d9be7c26cc7fd5',
  },
  {
    family: 'panorama_stitch',
    localPath: 'private-fixtures/panorama/overlap-stitch-v1/frame-01.raf',
    rawPixlsPath: 'Fujifilm/X-E3/DSCF2175.RAF',
    sha256: 'b2aeb7fd72a9ea116b1dcc2c8a8cf5462b15757ba3aca33bad8ce36339a1642f',
  },
  {
    family: 'panorama_stitch',
    localPath: 'private-fixtures/panorama/overlap-stitch-v1/frame-02.raf',
    rawPixlsPath: 'Fujifilm/X-E3/DSCF2176.RAF',
    sha256: '03d6e79ae79107c51d0e1c1c9e488a0ab20268cd9fe43f47d8ea3ea310df35c6',
  },
  {
    family: 'panorama_stitch',
    localPath: 'private-fixtures/panorama/overlap-stitch-v1/frame-03.raf',
    rawPixlsPath: 'Fujifilm/GFX 50R/2019-01-24-14-02-50_DSCF1316_e819634e46ecdb8ea241012ee70ae11e5c220c48.raf',
    sha256: '9d0570010a36fda60823de10837c47b39d7693ad8a87e531c859cfe411e41172',
  },
] as const satisfies ReadonlyArray<PublicRawFixtureSource>;

const argsSchema = z
  .object({
    allowFormatSmoke: z.boolean(),
    download: z.boolean(),
    family: z.union([fixtureFamilySchema, z.literal('all')]),
    privateRoot: z.string().trim().min(1),
  })
  .strict();

const args = argsSchema.parse({
  allowFormatSmoke: process.argv.includes('--allow-format-smoke'),
  download: process.argv.includes('--download'),
  family: parseFamilyArg(),
  privateRoot: process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? DEFAULT_PRIVATE_ROOT,
});

const selectedSources = publicRawFixtureSources.filter(
  (source) => args.family === 'all' || source.family === args.family,
);
if (selectedSources.length === 0) throw new Error(`No public RAW fixture sources selected for ${args.family}.`);

if (!args.download) {
  console.log(`public RAW fixture plan (${selectedSources.length} files, root=${args.privateRoot})`);
  for (const source of selectedSources) {
    console.log(
      `${source.family} ${fixtureFamilySuitability[source.family]} ${source.localPath} <= ${sourceUrl(source)}`,
    );
  }
  console.log(RAW_PIXLS_LICENSE_NOTE);
} else {
  assertDownloadAllowed(selectedSources);
  await downloadSources(selectedSources);
  console.log(`public RAW fixture download ok (${selectedSources.length} files, root=${args.privateRoot})`);
}

function parseFamilyArg(): FixtureFamily | 'all' {
  const familyArgIndex = process.argv.indexOf('--family');
  if (familyArgIndex === -1) return 'all';
  return fixtureFamilySchema.parse(process.argv[familyArgIndex + 1]);
}

function assertDownloadAllowed(sources: ReadonlyArray<PublicRawFixtureSource>): void {
  const formatSmokeFamilies = [
    ...new Set(
      sources
        .filter((source) => fixtureFamilySuitability[source.family] === 'format_smoke_only')
        .map((source) => source.family),
    ),
  ];
  if (formatSmokeFamilies.length > 0 && !args.allowFormatSmoke) {
    fail(
      `${formatSmokeFamilies.join(', ')} public RAW fixtures are format-smoke only; pass --allow-format-smoke to download them explicitly.`,
    );
  }
}

async function downloadSources(sources: ReadonlyArray<PublicRawFixtureSource>): Promise<void> {
  for (const source of sources) {
    const destination = resolve(args.privateRoot, source.localPath);
    await mkdir(dirname(destination), { recursive: true });
    const existing = await readIfPresent(destination);
    if (existing !== null && sha256(existing) === source.sha256) continue;

    const response = await fetch(sourceUrl(source), {
      headers: { 'User-Agent': 'RawEngine validation fixture downloader' },
    });
    if (!response.ok) throw new Error(`${source.rawPixlsPath}: download failed with HTTP ${response.status}`);

    const bytes = Buffer.from(await response.arrayBuffer());
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== source.sha256) {
      throw new Error(`${source.rawPixlsPath}: expected sha256 ${source.sha256}, got ${actualSha256}`);
    }
    await writeFile(destination, bytes);
  }
}

async function readIfPresent(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceUrl(source: PublicRawFixtureSource): string {
  return `${RAW_PIXLS_DOWNLOAD_ROOT}/${source.rawPixlsPath.split('/').map(encodeURIComponent).join('/')}`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export { RAW_PIXLS_LICENSE_NOTE, RAW_PIXLS_SOURCE_PAGE, publicRawFixtureSources };
