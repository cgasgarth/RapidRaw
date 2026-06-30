import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';

import { z } from 'zod';

import { parseComputationalMergeE2eProofManifest } from '../../../src/schemas/computationalMergeE2eProofSchemas.ts';
import { parsePrivateRawEvidenceLedger } from '../../../src/schemas/privateRawEvidenceSchemas.ts';

const argsSchema = z
  .object({
    materialize: z.enum(['copy', 'symlink']),
    privateRoot: z.string().trim().min(1),
    requireAssets: z.boolean(),
    selfTest: z.boolean(),
    source: z.string().trim().min(1).optional(),
    stressCandidate: z.boolean(),
  })
  .strict();

const exiftoolRowSchema = z
  .object({
    CreateDate: z.string().optional(),
    ExposureCompensation: z.number().optional(),
    ExposureTime: z.number().optional(),
    FNumber: z.number().optional(),
    FileName: z.string().optional(),
    FocalLength: z.number().optional(),
    ISO: z.number().optional(),
    LensModel: z.string().optional(),
    Model: z.string().optional(),
    SourceFile: z.string().trim().min(1),
  })
  .passthrough();

const exiftoolRowsSchema = z.array(exiftoolRowSchema);

type ExiftoolRow = z.infer<typeof exiftoolRowSchema>;

const DEFAULT_PRIVATE_ROOT = '/tmp/rawengine-private-root';
const HDR_INGEST_REPORT_PATH = 'private-artifacts/validation/computational-merge/hdr-source-ingest.json';
const FOCUS_INGEST_REPORT_PATH = 'private-artifacts/validation/computational-merge/focus-source-ingest.json';
const PANORAMA_INGEST_REPORT_PATH = 'private-artifacts/validation/computational-merge/panorama-source-ingest.json';
const SR_INGEST_REPORT_PATH = 'private-artifacts/validation/computational-merge/sr-source-ingest.json';
const MAX_HDR_BRACKET_SPAN_SECONDS = 20;
const MAX_HDR_BRACKET_SEQUENCE_GAP = 12;
const MIN_HDR_BRACKET_SPREAD_EV = 4;
const MAX_PANORAMA_SEQUENCE_SPAN_SECONDS = 60;
const MAX_PANORAMA_SEQUENCE_GAP = 12;

export interface ComputationalPrivateRootPrepConfig {
  expectedExtension: string;
  featureFamily: 'focus_stack' | 'hdr_merge' | 'panorama_stitch' | 'super_resolution';
  featureLabel: string;
  fixtureId: string;
  issue: number;
  minSources: number;
  preferredSourceFileNames?: ReadonlyArray<string>;
  sourceLabel: string;
  stressCandidate?: {
    expectedExtension: string;
    sourceLabel: string;
    sourceRelativePaths: ReadonlyArray<string>;
  };
  tempPrefix: string;
}

interface PrepareResult {
  failures: Array<string>;
  message: string;
  ok: boolean;
}

type Manifest = ReturnType<typeof parseComputationalMergeE2eProofManifest>;
type Ledger = ReturnType<typeof parsePrivateRawEvidenceLedger>;

export async function runComputationalPrivateRootPrep(config: ComputationalPrivateRootPrepConfig): Promise<void> {
  const args = argsSchema.parse({
    privateRoot: process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? DEFAULT_PRIVATE_ROOT,
    materialize: valueAfter('--materialize') ?? process.env.RAWENGINE_PRIVATE_RAW_MATERIALIZE ?? 'symlink',
    requireAssets: process.argv.includes('--require-assets'),
    selfTest: process.argv.includes('--self-test'),
    source: valueAfter('--source') ?? process.env.RAWENGINE_PRIVATE_RAW_SOURCE,
    stressCandidate: process.argv.includes('--stress-candidate'),
  });

  if (args.selfTest) {
    await runSelfTest(config);
    await runSourceIngestSelfTest(config);
    console.log(`${config.featureLabel} real RAW private root prep self-test ok`);
    return;
  }

  if (args.stressCandidate) {
    const result = await prepareStressCandidateRoot(config, args.privateRoot, args.requireAssets);
    if (!result.ok) {
      console.error(`${config.featureLabel} real RAW stress-candidate prep failed`);
      console.error(result.failures.slice(0, 12).join('\n'));
      process.exit(1);
    }
    console.log(result.message);
    return;
  }
  const manifest = await readManifest();
  const ledger = await readLedger();
  if (args.source !== undefined) {
    const result = await ingestPrivateSources(config, manifest, args.privateRoot, args.source, args.materialize);
    if (!result.ok) {
      console.error(`${config.featureLabel} real RAW private source ingest failed`);
      console.error(result.failures.slice(0, 12).join('\n'));
      process.exit(1);
    }
    console.log(result.message);
    return;
  }
  const result = await preparePrivateRoot(config, manifest, ledger, args.privateRoot, args.requireAssets);
  if (!result.ok) {
    console.error(`${config.featureLabel} real RAW private root prep failed`);
    console.error(result.failures.slice(0, 12).join('\n'));
    process.exit(1);
  }
  console.log(result.message);
}

async function prepareStressCandidateRoot(
  config: ComputationalPrivateRootPrepConfig,
  privateRootInput: string,
  requireAssets: boolean,
): Promise<PrepareResult> {
  const stressCandidate = config.stressCandidate;
  if (stressCandidate === undefined)
    return failure([`${config.featureLabel}: no stress-candidate fixture configured.`]);

  const failures: Array<string> = [];
  const privateRoot = resolve(privateRootInput);
  if (!isAbsolute(privateRootInput)) failures.push('RAWENGINE_PRIVATE_RAW_ROOT must be absolute.');

  const sourcePaths = stressCandidate.sourceRelativePaths.map((sourcePath) => {
    if (extname(sourcePath).toLowerCase() !== stressCandidate.expectedExtension) {
      failures.push(`${sourcePath}: expected ${stressCandidate.expectedExtension.slice(1).toUpperCase()} source.`);
    }
    return resolvePrivatePath(privateRoot, sourcePath, failures);
  });

  if (sourcePaths[0] !== undefined) await mkdir(dirname(sourcePaths[0]), { recursive: true });
  if (failures.length > 0) return failure(failures);

  const missingSources = [];
  for (const sourcePath of sourcePaths) {
    if (!(await pathExists(sourcePath))) missingSources.push(relative(privateRoot, sourcePath));
  }
  if (missingSources.length === sourcePaths.length && !requireAssets) {
    return {
      failures: [],
      message: `${config.featureLabel} stress-candidate prep skipped (add ${sourcePaths.length} ${stressCandidate.sourceLabel} under ${privateRoot})`,
      ok: true,
    };
  }
  if (missingSources.length > 0) {
    return failure(missingSources.map((sourcePath) => `missing private RAW stress-candidate source ${sourcePath}`));
  }

  return {
    failures: [],
    message: `${config.featureLabel} stress-candidate prep ok (${sourcePaths.length} sources; not proof acceptance)`,
    ok: true,
  };
}

async function ingestPrivateSources(
  config: ComputationalPrivateRootPrepConfig,
  manifest: Manifest,
  privateRootInput: string,
  sourceRootInput: string,
  materialize: 'copy' | 'symlink',
): Promise<PrepareResult> {
  if (
    config.featureFamily !== 'focus_stack' &&
    config.featureFamily !== 'hdr_merge' &&
    config.featureFamily !== 'panorama_stitch' &&
    config.featureFamily !== 'super_resolution'
  ) {
    return failure([
      `${config.featureLabel}: --source ingest currently supports focus, HDR, panorama, and SR sources only.`,
    ]);
  }

  const failures: Array<string> = [];
  const privateRoot = resolve(privateRootInput);
  const sourceRoot = resolve(sourceRootInput);
  if (!isAbsolute(privateRootInput)) failures.push('RAWENGINE_PRIVATE_RAW_ROOT must be absolute.');
  if (!(await pathExists(sourceRoot))) failures.push(`${sourceRoot}: source directory does not exist.`);

  const proofCase = manifest.proofCases.find((candidate) => candidate.fixtureId === config.fixtureId);
  if (proofCase === undefined) failures.push(`${config.fixtureId}: missing proof case.`);
  const targetPaths =
    proofCase?.localSourceRelativePaths.map((sourcePath) => resolvePrivatePath(privateRoot, sourcePath, failures)) ??
    [];
  if (targetPaths.length < config.minSources) {
    failures.push(`${config.fixtureId}: expected at least ${config.minSources} target source paths.`);
  }
  if (failures.length > 0) return failure(failures);

  const rawPaths = await findRawPaths(sourceRoot, config.expectedExtension);
  if (rawPaths.length < config.minSources) {
    return failure([
      `${sourceRoot}: found ${rawPaths.length} ${config.expectedExtension.toUpperCase()} files; need ${config.minSources}.`,
    ]);
  }

  const metadata = await readExifMetadata(rawPaths);
  const candidate =
    choosePreferredSourceCandidate(metadata, config.preferredSourceFileNames, config.featureFamily) ??
    (config.featureFamily === 'hdr_merge'
      ? chooseHdrBracketCandidate(metadata, config.minSources)
      : chooseCaptureSequenceCandidate(metadata, config.minSources));
  if (candidate === undefined) {
    return failure([
      `${sourceRoot}: no ${config.minSources}-frame ${config.featureLabel} source candidate found (${sourceCandidateRequirement(config.featureFamily)}).`,
    ]);
  }

  const selected =
    config.featureFamily === 'hdr_merge'
      ? [...candidate.rows].sort((left, right) => exposureValue(right) - exposureValue(left))
      : [...candidate.rows].sort((left, right) => sequenceNumber(left) - sequenceNumber(right));
  await materializePrivateSources(selected, targetPaths, materialize);
  await writeSourceIngestReport(privateRoot, sourceRoot, selected, candidate.score, materialize, config.featureFamily);

  return {
    failures: [],
    message: `${config.featureLabel} private source ingest ok (${selected.length} sources; ${candidate.scoreLabel}: ${candidate.score.toFixed(2)}; ${materialize})`,
    ok: true,
  };
}

async function preparePrivateRoot(
  config: ComputationalPrivateRootPrepConfig,
  manifest: Manifest,
  ledger: Ledger,
  privateRootInput: string,
  requireAssets: boolean,
): Promise<PrepareResult> {
  const failures: Array<string> = [];
  const privateRoot = resolve(privateRootInput);
  if (!isAbsolute(privateRootInput)) failures.push('RAWENGINE_PRIVATE_RAW_ROOT must be absolute.');

  const proofCase = manifest.proofCases.find((candidate) => candidate.fixtureId === config.fixtureId);
  if (proofCase === undefined) return failure([`${config.fixtureId}: missing proof case.`]);
  if (proofCase.featureFamily !== config.featureFamily) {
    failures.push(`${proofCase.fixtureId}: featureFamily must be ${config.featureFamily}.`);
  }
  if (proofCase.implementationIssue !== config.issue) {
    failures.push(`${proofCase.fixtureId}: implementationIssue must be #${config.issue}.`);
  }
  if (proofCase.localSourceRelativePaths.length < config.minSources) {
    failures.push(`${proofCase.fixtureId}: expected at least ${config.minSources} source paths.`);
  }

  const ledgerEntry = ledger.entries.find((entry) => entry.evidenceId === proofCase.evidenceId);
  if (ledgerEntry === undefined) {
    failures.push(`${proofCase.evidenceId}: missing private RAW evidence ledger entry.`);
  } else {
    if (ledgerEntry.featureFamily !== config.featureFamily) {
      failures.push(`${ledgerEntry.evidenceId}: ledger featureFamily must be ${config.featureFamily}.`);
    }
    if (ledgerEntry.trackingIssue !== config.issue) {
      failures.push(`${ledgerEntry.evidenceId}: ledger trackingIssue must be #${config.issue}.`);
    }
  }

  const sourcePaths = proofCase.localSourceRelativePaths.map((sourcePath) => {
    if (extname(sourcePath).toLowerCase() !== config.expectedExtension) {
      failures.push(`${sourcePath}: expected ${config.expectedExtension.slice(1).toUpperCase()} source.`);
    }
    return resolvePrivatePath(privateRoot, sourcePath, failures);
  });
  for (const artifact of proofCase.artifacts) {
    const artifactPath = resolvePrivatePath(privateRoot, artifact.path, failures);
    await mkdir(artifact.kind === 'source_raw_sequence_private' ? artifactPath : dirname(artifactPath), {
      recursive: true,
    });
  }
  if (sourcePaths[0] !== undefined) await mkdir(dirname(sourcePaths[0]), { recursive: true });
  if (failures.length > 0) return failure(failures);

  const missingSources = [];
  for (const sourcePath of sourcePaths) {
    if (!(await pathExists(sourcePath))) missingSources.push(relative(privateRoot, sourcePath));
  }

  if (missingSources.length === sourcePaths.length && !requireAssets) {
    return {
      failures: [],
      message: `${config.featureLabel} real RAW private root prep skipped (add ${sourcePaths.length} ${config.sourceLabel} under ${privateRoot})`,
      ok: true,
    };
  }
  if (missingSources.length > 0) {
    return failure(missingSources.map((sourcePath) => `missing private RAW source ${sourcePath}`));
  }

  return {
    failures: [],
    message: `${config.featureLabel} real RAW private root prep ok (${sourcePaths.length} sources)`,
    ok: true,
  };
}

async function runSelfTest(config: ComputationalPrivateRootPrepConfig): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), config.tempPrefix));
  try {
    const manifest = await readManifest();
    const ledger = await readLedger();
    const proofCase = manifest.proofCases.find((candidate) => candidate.fixtureId === config.fixtureId);
    if (proofCase === undefined) throw new Error(`${config.fixtureId}: missing proof case.`);

    for (const sourcePath of proofCase.localSourceRelativePaths) {
      const absolutePath = resolve(root, sourcePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, `fake-private-${config.featureLabel}-raw-${basename(sourcePath)}`);
    }

    const result = await preparePrivateRoot(config, manifest, ledger, root, true);
    if (!result.ok || !result.message.includes(`${proofCase.localSourceRelativePaths.length} sources`)) {
      throw new Error(result.failures.join('; ') || `expected ${proofCase.localSourceRelativePaths.length} sources`);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function runSourceIngestSelfTest(config: ComputationalPrivateRootPrepConfig): Promise<void> {
  if (
    config.featureFamily !== 'focus_stack' &&
    config.featureFamily !== 'hdr_merge' &&
    config.featureFamily !== 'panorama_stitch' &&
    config.featureFamily !== 'super_resolution'
  ) {
    return;
  }

  const root = await mkdtemp(resolve(tmpdir(), `${config.tempPrefix}source-root-`));
  const sourceRoot = await mkdtemp(resolve(tmpdir(), `${config.tempPrefix}source-input-`));
  try {
    const sourceRows = Array.from({ length: config.minSources }, (_value, index) =>
      sampleExifRow(
        sourceRoot,
        `_DSC${String(index + 1).padStart(4, '0')}.ARW`,
        `2026:06:20 12:00:0${String(Math.min(index * 2, 9))}`,
        config.featureFamily === 'hdr_merge' ? 1 / (4000 / 4 ** index) : 1 / 1000,
        8,
        100,
      ),
    );
    for (const row of sourceRows) await writeFile(row.SourceFile, 'fake-private-hdr-raw');

    const manifest = await readManifest();
    const proofCase = manifest.proofCases.find((candidate) => candidate.fixtureId === config.fixtureId);
    if (proofCase === undefined) throw new Error(`${config.fixtureId}: missing proof case.`);

    const candidate =
      config.featureFamily === 'hdr_merge'
        ? chooseHdrBracketCandidate(sourceRows, config.minSources)
        : chooseCaptureSequenceCandidate(sourceRows, config.minSources);
    if (
      candidate === undefined ||
      (config.featureFamily === 'hdr_merge' && candidate.score < MIN_HDR_BRACKET_SPREAD_EV)
    ) {
      throw new Error('Expected synthetic HDR bracket source candidate.');
    }

    const failures: Array<string> = [];
    const targetPaths = proofCase.localSourceRelativePaths.map((sourcePath) =>
      resolvePrivatePath(root, sourcePath, failures),
    );
    if (failures.length > 0) throw new Error(failures.join('; '));
    const selectedRows =
      config.featureFamily === 'hdr_merge'
        ? [...candidate.rows].sort((left, right) => exposureValue(right) - exposureValue(left))
        : [...candidate.rows].sort((left, right) => sequenceNumber(left) - sequenceNumber(right));
    await materializePrivateSources(selectedRows, targetPaths, 'copy');
    for (const targetPath of targetPaths) {
      if (!(await pathExists(targetPath))) throw new Error(`${targetPath}: expected copied private source.`);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
    await rm(sourceRoot, { force: true, recursive: true });
  }
}

async function findRawPaths(root: string, expectedExtension: string): Promise<Array<string>> {
  const paths: Array<string> = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await findRawPaths(path, expectedExtension)));
      continue;
    }
    if (entry.isFile() && extname(entry.name).toLowerCase() === expectedExtension) paths.push(path);
  }
  return paths.sort();
}

async function readExifMetadata(paths: ReadonlyArray<string>): Promise<Array<ExiftoolRow>> {
  const rows: Array<ExiftoolRow> = [];
  for (let index = 0; index < paths.length; index += 200) {
    const chunk = paths.slice(index, index + 200);
    const result = Bun.spawnSync([
      'exiftool',
      '-json',
      '-n',
      '-SourceFile',
      '-FileName',
      '-CreateDate',
      '-ExposureTime',
      '-FNumber',
      '-FocalLength',
      '-ISO',
      '-ExposureCompensation',
      '-Model',
      '-LensModel',
      ...chunk,
    ]);
    if (!result.success) {
      throw new Error(`exiftool failed while reading ${chunk.length} RAW files.`);
    }
    rows.push(...exiftoolRowsSchema.parse(JSON.parse(result.stdout.toString())));
  }
  return rows;
}

function chooseHdrBracketCandidate(rows: ReadonlyArray<ExiftoolRow>, sourceCount: number) {
  const candidates = rows
    .filter(isHdrMetadataUsable)
    .sort((left, right) => captureTimestamp(left) - captureTimestamp(right));
  let best: { rows: ReadonlyArray<ExiftoolRow>; score: number; scoreLabel: string } | undefined;

  for (let index = 0; index <= candidates.length - sourceCount; index += 1) {
    const window = candidates.slice(index, index + sourceCount);
    if (!hasConsistentCaptureMetadata(window)) continue;

    const first = window[0];
    const last = window[window.length - 1];
    if (first === undefined || last === undefined) continue;

    const spanSeconds = captureTimestamp(last) - captureTimestamp(first);
    const sequenceGap = sequenceNumber(last) - sequenceNumber(first);
    const exposureValues = window.map(exposureValue);
    const spreadEv = Math.max(...exposureValues) - Math.min(...exposureValues);
    if (
      spanSeconds > MAX_HDR_BRACKET_SPAN_SECONDS ||
      sequenceGap > MAX_HDR_BRACKET_SEQUENCE_GAP ||
      spreadEv < MIN_HDR_BRACKET_SPREAD_EV
    ) {
      continue;
    }
    if (best === undefined || spreadEv > best.score) best = { rows: window, score: spreadEv, scoreLabel: 'spreadEv' };
  }

  return best;
}

function chooseCaptureSequenceCandidate(rows: ReadonlyArray<ExiftoolRow>, sourceCount: number) {
  const candidates = rows
    .filter(isHdrMetadataUsable)
    .sort((left, right) => captureTimestamp(left) - captureTimestamp(right));
  let best: { rows: ReadonlyArray<ExiftoolRow>; score: number; scoreLabel: string } | undefined;

  for (let index = 0; index <= candidates.length - sourceCount; index += 1) {
    const window = candidates.slice(index, index + sourceCount);
    if (!hasConsistentCaptureMetadata(window) || !hasConsistentPanoramaExposure(window)) continue;

    const first = window[0];
    const last = window[window.length - 1];
    if (first === undefined || last === undefined) continue;

    const spanSeconds = captureTimestamp(last) - captureTimestamp(first);
    const sequenceGap = sequenceNumber(last) - sequenceNumber(first);
    if (spanSeconds > MAX_PANORAMA_SEQUENCE_SPAN_SECONDS || sequenceGap > MAX_PANORAMA_SEQUENCE_GAP) {
      continue;
    }
    const score = window.length * 100 - spanSeconds - sequenceGap;
    if (best === undefined || score > best.score) best = { rows: window, score, scoreLabel: 'sequenceScore' };
  }

  return best;
}

function choosePreferredSourceCandidate(
  rows: ReadonlyArray<ExiftoolRow>,
  preferredFileNames: ReadonlyArray<string> | undefined,
  featureFamily: 'focus_stack' | 'hdr_merge' | 'panorama_stitch' | 'super_resolution',
) {
  if (preferredFileNames === undefined || preferredFileNames.length === 0) return undefined;

  const rowsForPreferred = featureFamily === 'focus_stack' ? rows : rows.filter(isHdrMetadataUsable);
  const usableRowsByName = new Map(
    rowsForPreferred.map((row) => [(row.FileName ?? basename(row.SourceFile)).toLowerCase(), row] as const),
  );
  const preferredRows = preferredFileNames
    .map((fileName) => usableRowsByName.get(fileName.toLowerCase()))
    .filter((row): row is ExiftoolRow => row !== undefined);
  if (preferredRows.length !== preferredFileNames.length) return undefined;
  if (!hasConsistentCaptureMetadata(preferredRows)) return undefined;
  if (featureFamily === 'panorama_stitch' && !hasConsistentPanoramaExposure(preferredRows)) return undefined;

  const first = preferredRows[0];
  const last = preferredRows[preferredRows.length - 1];
  if (first === undefined || last === undefined) return undefined;

  const spanSeconds = captureTimestamp(last) - captureTimestamp(first);
  const sequenceGap = sequenceNumber(last) - sequenceNumber(first);
  return {
    rows: preferredRows,
    score: preferredRows.length * 100 - spanSeconds - sequenceGap,
    scoreLabel: 'preferredSequenceScore',
  };
}

function isHdrMetadataUsable(row: ExiftoolRow): row is ExiftoolRow & {
  CreateDate: string;
  ExposureTime: number;
  FNumber: number;
  ISO: number;
} {
  return (
    row.CreateDate !== undefined &&
    row.ExposureTime !== undefined &&
    row.ExposureTime > 0 &&
    row.FNumber !== undefined &&
    row.FNumber > 0 &&
    row.ISO !== undefined &&
    row.ISO > 0 &&
    Number.isFinite(sequenceNumber(row)) &&
    Number.isFinite(captureTimestamp(row)) &&
    Number.isFinite(exposureValue(row))
  );
}

function hasConsistentCaptureMetadata(rows: ReadonlyArray<ExiftoolRow>): boolean {
  const [first] = rows;
  if (first === undefined) return false;
  return rows.every((row) => row.Model === first.Model && row.LensModel === first.LensModel);
}

function hasConsistentPanoramaExposure(rows: ReadonlyArray<ExiftoolRow>): boolean {
  const [first] = rows;
  if (
    first === undefined ||
    first.FNumber === undefined ||
    first.FocalLength === undefined ||
    first.ISO === undefined ||
    first.ExposureTime === undefined
  ) {
    return false;
  }
  return rows.every(
    (row) =>
      row.FNumber !== undefined &&
      row.FocalLength !== undefined &&
      row.ISO !== undefined &&
      row.ExposureTime !== undefined &&
      Math.abs(row.FNumber - first.FNumber) <= 0.01 &&
      Math.abs(row.FocalLength - first.FocalLength) <= 0.1 &&
      row.ISO === first.ISO &&
      Math.abs(row.ExposureTime - first.ExposureTime) <= 1e-9,
  );
}

function captureTimestamp(row: ExiftoolRow): number {
  const match = /^(?<year>\d{4}):(?<month>\d{2}):(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})/u.exec(
    row.CreateDate ?? '',
  );
  if (match?.groups === undefined) return Number.NaN;
  const { day, hour, minute, month, second, year } = match.groups;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) / 1000;
}

function exposureValue(row: ExiftoolRow): number {
  if (row.ExposureTime === undefined || row.FNumber === undefined || row.ISO === undefined) return Number.NaN;
  return Math.log2((row.FNumber * row.FNumber) / row.ExposureTime) - Math.log2(row.ISO / 100);
}

function sequenceNumber(row: ExiftoolRow): number {
  const match = /(\d+)/u.exec(row.FileName ?? basename(row.SourceFile));
  return match === null ? Number.NaN : Number(match[1]);
}

async function materializePrivateSources(
  selectedRows: ReadonlyArray<ExiftoolRow>,
  targetPaths: ReadonlyArray<string>,
  materialize: 'copy' | 'symlink',
): Promise<void> {
  for (const [index, targetPath] of targetPaths.entries()) {
    const sourcePath = selectedRows[index]?.SourceFile;
    if (sourcePath === undefined) throw new Error(`${targetPath}: missing selected source.`);
    await mkdir(dirname(targetPath), { recursive: true });
    await rm(targetPath, { force: true });
    if (materialize === 'copy') {
      await copyFile(sourcePath, targetPath);
    } else {
      await symlink(sourcePath, targetPath);
    }
  }
}

async function writeSourceIngestReport(
  privateRoot: string,
  sourceRoot: string,
  selectedRows: ReadonlyArray<ExiftoolRow>,
  score: number,
  materialize: 'copy' | 'symlink',
  featureFamily: 'focus_stack' | 'hdr_merge' | 'panorama_stitch' | 'super_resolution',
): Promise<void> {
  const reportRelativePath = {
    focus_stack: FOCUS_INGEST_REPORT_PATH,
    hdr_merge: HDR_INGEST_REPORT_PATH,
    panorama_stitch: PANORAMA_INGEST_REPORT_PATH,
    super_resolution: SR_INGEST_REPORT_PATH,
  }[featureFamily];
  const reportPath = resolvePrivatePath(privateRoot, reportRelativePath, []);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        featureFamily,
        materialize,
        selectedSources: selectedRows.map((row) => ({
          captureDate: row.CreateDate,
          exposureEv: Number(exposureValue(row).toFixed(4)),
          exposureTime: row.ExposureTime,
          focalLength: row.FocalLength,
          fileName: row.FileName ?? basename(row.SourceFile),
          iso: row.ISO,
          lensModel: row.LensModel,
          model: row.Model,
          sourceRelativePath: relative(sourceRoot, row.SourceFile),
        })),
        sourceRoot,
        score: Number(score.toFixed(4)),
      },
      null,
      2,
    )}\n`,
  );
}

function sampleExifRow(
  root: string,
  fileName: string,
  createDate: string,
  exposureTime: number,
  fNumber: number,
  iso: number,
): ExiftoolRow {
  return exiftoolRowSchema.parse({
    CreateDate: createDate,
    ExposureTime: exposureTime,
    FNumber: fNumber,
    FileName: fileName,
    FocalLength: 35,
    ISO: iso,
    LensModel: 'Synthetic 35mm',
    Model: 'Synthetic Camera',
    SourceFile: resolve(root, fileName),
  });
}

function sourceCandidateRequirement(
  featureFamily: 'focus_stack' | 'hdr_merge' | 'panorama_stitch' | 'super_resolution',
): string {
  if (featureFamily === 'hdr_merge') {
    return `need <=${MAX_HDR_BRACKET_SPAN_SECONDS}s, sequence gap <=${MAX_HDR_BRACKET_SEQUENCE_GAP}, >=${MIN_HDR_BRACKET_SPREAD_EV} EV spread`;
  }
  return `need <=${MAX_PANORAMA_SEQUENCE_SPAN_SECONDS}s, sequence gap <=${MAX_PANORAMA_SEQUENCE_GAP}, same camera/lens/focal length/exposure`;
}

async function readManifest(): Promise<Manifest> {
  return parseComputationalMergeE2eProofManifest(
    JSON.parse(await readFile('fixtures/validation/app-server/computational-merge-e2e-proof.json', 'utf8')),
  );
}

async function readLedger(): Promise<Ledger> {
  return parsePrivateRawEvidenceLedger(
    JSON.parse(await readFile('fixtures/detail/proofs/private-raw-evidence-ledger.json', 'utf8')),
  );
}

function resolvePrivatePath(root: string, candidate: string, failures: Array<string>): string {
  if (isAbsolute(candidate) || candidate.includes('..')) {
    failures.push(`${candidate}: must be private-root relative without traversal.`);
    return root;
  }
  const resolvedPath = resolve(root, candidate);
  const relativePath = relative(root, resolvedPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    failures.push(`${candidate}: resolves outside private root.`);
  }
  return resolvedPath;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function failure(failures: Array<string>): PrepareResult {
  return { failures, message: '', ok: false };
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
