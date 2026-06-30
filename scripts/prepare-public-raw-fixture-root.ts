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
const IDR_FOCUS_STACK_LICENSE_NOTE =
  'IDR idr0134 / BioImage Archive S-BIAD188 is CC BY 4.0; this script stores local validation copies only.';
const PIXLS_IR_PANORAMA_LICENSE_NOTE =
  'Pixls Play Raw infrared panorama thread files are CC BY-SA; this script stores local stress-candidate validation copies only.';

const fixtureFamilySchema = z.enum(['focus_stack', 'panorama_stitch', 'super_resolution']);
type FixtureFamily = z.infer<typeof fixtureFamilySchema>;
type FixtureSuitability = 'format_smoke_only' | 'runtime_proof_candidate' | 'stress_candidate_not_accepted';

interface PublicRawFixtureSource {
  family: FixtureFamily;
  localPath: string;
  licenseNote: string;
  sha256: string;
  sourceLabel: string;
  sourceUrl: string;
  suitability: FixtureSuitability;
}

const publicRawFixtureSources = [
  {
    family: 'focus_stack',
    localPath: 'private-fixtures/focus-stack/plane-transition-v1/frame-01.cr3',
    licenseNote: IDR_FOCUS_STACK_LICENSE_NOTE,
    sha256: 'bb376fa2f4d5bb2b319f184245a5dc2ee7d1fc1e05673092af1cea66b91cd252',
    sourceLabel: 'IDR idr0134 / BioImage Archive S-BIAD188',
    sourceUrl:
      'https://ftp.ebi.ac.uk/biostudies/fire/S-BIAD/188/S-BIAD188/Files/Diplophyllum%20albicans/IMG_0006%20Diplophyllum%20albicans%20stature%20ventral%20side%20%282.5x%29.CR3',
    suitability: 'runtime_proof_candidate',
  },
  {
    family: 'focus_stack',
    localPath: 'private-fixtures/focus-stack/plane-transition-v1/frame-02.cr3',
    licenseNote: IDR_FOCUS_STACK_LICENSE_NOTE,
    sha256: '806826bf59d5695b50306d63752dfb94834384be76236e3a8c1e3750f5b89dee',
    sourceLabel: 'IDR idr0134 / BioImage Archive S-BIAD188',
    sourceUrl:
      'https://ftp.ebi.ac.uk/biostudies/fire/S-BIAD/188/S-BIAD188/Files/Diplophyllum%20albicans/IMG_0033%20Diplophyllum%20albicans%20stature%20ventral%20side%20%282.5x%29.CR3',
    suitability: 'runtime_proof_candidate',
  },
  {
    family: 'focus_stack',
    localPath: 'private-fixtures/focus-stack/plane-transition-v1/frame-03.cr3',
    licenseNote: IDR_FOCUS_STACK_LICENSE_NOTE,
    sha256: 'c614c763774796fc77585a542bae2673a90772c7110e65b495018e0ccba08a19',
    sourceLabel: 'IDR idr0134 / BioImage Archive S-BIAD188',
    sourceUrl:
      'https://ftp.ebi.ac.uk/biostudies/fire/S-BIAD/188/S-BIAD188/Files/Diplophyllum%20albicans/IMG_0060%20Diplophyllum%20albicans%20stature%20ventral%20side%20%282.5x%29.CR3',
    suitability: 'runtime_proof_candidate',
  },
  {
    family: 'super_resolution',
    localPath: 'private-fixtures/super-resolution/subpixel-detail-v1/frame-01.nef',
    licenseNote: RAW_PIXLS_LICENSE_NOTE,
    sha256: '880c60c5f611adf6b70de3d099f8433492de3a3d96866d570122f17f0a651fc8',
    sourceLabel: RAW_PIXLS_SOURCE_PAGE,
    sourceUrl: sourceUrlFromRawPixlsPath('Nikon/D3/JD1_8203.NEF'),
    suitability: 'runtime_proof_candidate',
  },
  {
    family: 'super_resolution',
    localPath: 'private-fixtures/super-resolution/subpixel-detail-v1/frame-02.nef',
    licenseNote: RAW_PIXLS_LICENSE_NOTE,
    sha256: 'bd1efee38aab8daf79c199e076785125ece01eb8f5ef6741121b0f313ee4ac04',
    sourceLabel: RAW_PIXLS_SOURCE_PAGE,
    sourceUrl: sourceUrlFromRawPixlsPath('Nikon/D3/JD1_8204.NEF'),
    suitability: 'runtime_proof_candidate',
  },
  {
    family: 'super_resolution',
    localPath: 'private-fixtures/super-resolution/subpixel-detail-v1/frame-03.nef',
    licenseNote: RAW_PIXLS_LICENSE_NOTE,
    sha256: '6c4ca5ac7525c01c972f517503c47389f2f244c1fab2ad4ea9d10c63d36c42e6',
    sourceLabel: RAW_PIXLS_SOURCE_PAGE,
    sourceUrl: sourceUrlFromRawPixlsPath('Nikon/D3/JD1_8205.NEF'),
    suitability: 'runtime_proof_candidate',
  },
  {
    family: 'super_resolution',
    localPath: 'private-fixtures/super-resolution/subpixel-detail-v1/frame-04.nef',
    licenseNote: RAW_PIXLS_LICENSE_NOTE,
    sha256: '0626c09a58ca12ee4c12f919772abd4fd053c7d88c2f2b25e8d9be7c26cc7fd5',
    sourceLabel: RAW_PIXLS_SOURCE_PAGE,
    sourceUrl: sourceUrlFromRawPixlsPath('Nikon/D3/JD1_8206.NEF'),
    suitability: 'runtime_proof_candidate',
  },
  {
    family: 'panorama_stitch',
    localPath: 'private-fixtures/panorama/overlap-stitch-v1/frame-01.raf',
    licenseNote: RAW_PIXLS_LICENSE_NOTE,
    sha256: 'b2aeb7fd72a9ea116b1dcc2c8a8cf5462b15757ba3aca33bad8ce36339a1642f',
    sourceLabel: RAW_PIXLS_SOURCE_PAGE,
    sourceUrl: sourceUrlFromRawPixlsPath('Fujifilm/X-E3/DSCF2175.RAF'),
    suitability: 'format_smoke_only',
  },
  {
    family: 'panorama_stitch',
    localPath: 'private-fixtures/panorama/overlap-stitch-v1/frame-02.raf',
    licenseNote: RAW_PIXLS_LICENSE_NOTE,
    sha256: '03d6e79ae79107c51d0e1c1c9e488a0ab20268cd9fe43f47d8ea3ea310df35c6',
    sourceLabel: RAW_PIXLS_SOURCE_PAGE,
    sourceUrl: sourceUrlFromRawPixlsPath('Fujifilm/X-E3/DSCF2176.RAF'),
    suitability: 'format_smoke_only',
  },
  {
    family: 'panorama_stitch',
    localPath: 'private-fixtures/panorama/overlap-stitch-v1/frame-03.raf',
    licenseNote: RAW_PIXLS_LICENSE_NOTE,
    sha256: '9d0570010a36fda60823de10837c47b39d7693ad8a87e531c859cfe411e41172',
    sourceLabel: RAW_PIXLS_SOURCE_PAGE,
    sourceUrl: sourceUrlFromRawPixlsPath(
      'Fujifilm/GFX 50R/2019-01-24-14-02-50_DSCF1316_e819634e46ecdb8ea241012ee70ae11e5c220c48.raf',
    ),
    suitability: 'format_smoke_only',
  },
  {
    family: 'panorama_stitch',
    localPath: 'private-fixtures/panorama/stress-pixls-ir-v1/frame-01.arw',
    licenseNote: PIXLS_IR_PANORAMA_LICENSE_NOTE,
    sha256: '6ff3306d1b96fb6167209154f35b82b24f5cbce10b1f36b91b935d8a84111908',
    sourceLabel: 'Pixls Play Raw infrared panorama thread',
    sourceUrl: 'https://discuss.pixls.us/uploads/short-url/nJZkxLTPSeKWd1ObE2ArbeKwyHW.ARW',
    suitability: 'stress_candidate_not_accepted',
  },
  {
    family: 'panorama_stitch',
    localPath: 'private-fixtures/panorama/stress-pixls-ir-v1/frame-02.arw',
    licenseNote: PIXLS_IR_PANORAMA_LICENSE_NOTE,
    sha256: 'ef8df7635dc81795a8cf86ea32fde5c1199931c6e4a92749cfddc98d6582d69a',
    sourceLabel: 'Pixls Play Raw infrared panorama thread',
    sourceUrl: 'https://discuss.pixls.us/uploads/short-url/685WsnCE0ifQpnV0rBps0L2S4dn.ARW',
    suitability: 'stress_candidate_not_accepted',
  },
  {
    family: 'panorama_stitch',
    localPath: 'private-fixtures/panorama/stress-pixls-ir-v1/frame-03.arw',
    licenseNote: PIXLS_IR_PANORAMA_LICENSE_NOTE,
    sha256: '473208ca1bfaac2a56181f899c66cc17412424742d5d81d6a777223d34a96db0',
    sourceLabel: 'Pixls Play Raw infrared panorama thread',
    sourceUrl: 'https://discuss.pixls.us/uploads/short-url/lpXHc3S2DFipH1Dl13SDGcR0pfk.ARW',
    suitability: 'stress_candidate_not_accepted',
  },
  {
    family: 'panorama_stitch',
    localPath: 'private-fixtures/panorama/stress-pixls-ir-v1/frame-04.arw',
    licenseNote: PIXLS_IR_PANORAMA_LICENSE_NOTE,
    sha256: 'a5265f3cf383676b5d659fe54e3fe693ed42bc00e2a19b361b9b8a03e5289050',
    sourceLabel: 'Pixls Play Raw infrared panorama thread',
    sourceUrl: 'https://discuss.pixls.us/uploads/short-url/vDDBf8Evy7T8oHF2MwBUDQgrY9E.ARW',
    suitability: 'stress_candidate_not_accepted',
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
      `${source.family} ${source.suitability} ${source.localPath} <= ${source.sourceLabel}: ${source.sourceUrl}`,
    );
  }
  for (const licenseNote of new Set(selectedSources.map((source) => source.licenseNote))) {
    console.log(licenseNote);
  }
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
    ...new Set(sources.filter((source) => source.suitability === 'format_smoke_only').map((source) => source.family)),
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

    const response = await fetch(source.sourceUrl, {
      headers: { 'User-Agent': 'RawEngine validation fixture downloader' },
    });
    if (!response.ok) throw new Error(`${source.sourceUrl}: download failed with HTTP ${response.status}`);

    const bytes = Buffer.from(await response.arrayBuffer());
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== source.sha256) {
      throw new Error(`${source.sourceUrl}: expected sha256 ${source.sha256}, got ${actualSha256}`);
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

function sourceUrlFromRawPixlsPath(path: string): string {
  return `${RAW_PIXLS_DOWNLOAD_ROOT}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export { IDR_FOCUS_STACK_LICENSE_NOTE, publicRawFixtureSources, RAW_PIXLS_LICENSE_NOTE, RAW_PIXLS_SOURCE_PAGE };
