import { createHash, createPrivateKey, createPublicKey, type KeyLike, KeyObject, sign, verify } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { z } from 'zod';
import { type PerformanceRunReceipt, type PerformanceScenario, performanceRunReceiptSchema } from './model';
import { comparePerformanceReceipts } from './runner';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

const baselineEntrySchema = z.object({
  approvedAt: z.string().datetime(),
  actor: z.string().trim().min(3),
  reason: z.string().trim().min(8),
  source: z.object({
    runId: z.string().min(1),
    commit: z.string().regex(/^[0-9a-f]{40}$/u),
    receiptSha256: sha256Schema,
  }),
  receipt: performanceRunReceiptSchema,
  previousHash: z.union([z.literal('genesis'), sha256Schema]),
  entryHash: sha256Schema,
  signature: z.object({
    algorithm: z.literal('ed25519'),
    publicKey: z.string().includes('BEGIN PUBLIC KEY'),
    value: z.string().min(32),
  }),
});

export const baselineHistorySchema = z.object({ schemaVersion: z.literal(2), entries: z.array(baselineEntrySchema) });

export type BaselineHistory = z.infer<typeof baselineHistorySchema>;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON cannot encode a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  throw new Error(`Canonical JSON cannot encode ${typeof value}.`);
}

const digest = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');

const unsignedEntry = (entry: BaselineHistory['entries'][number]) => ({
  approvedAt: entry.approvedAt,
  actor: entry.actor,
  previousHash: entry.previousHash,
  reason: entry.reason,
  receipt: entry.receipt,
  source: entry.source,
});

export function verifyBaselineHistory(history: BaselineHistory): BaselineHistory {
  const actorKeys = new Map<string, string>();
  let previousHash: 'genesis' | string = 'genesis';
  for (const entry of history.entries) {
    if (entry.previousHash !== previousHash)
      throw new Error(`Baseline history chain broke before ${entry.receipt.runId}.`);
    const receiptSha256 = digest(entry.receipt);
    if (
      entry.source.runId !== entry.receipt.runId ||
      entry.source.commit !== entry.receipt.identity.git.commit ||
      entry.source.receiptSha256 !== receiptSha256
    )
      throw new Error(`Baseline approval source provenance is invalid for ${entry.receipt.runId}.`);
    const expectedHash = digest(unsignedEntry(entry));
    if (entry.entryHash !== expectedHash)
      throw new Error(`Baseline history entry hash is invalid for ${entry.receipt.runId}.`);
    const registeredKey = actorKeys.get(entry.actor);
    if (registeredKey !== undefined && registeredKey !== entry.signature.publicKey)
      throw new Error(`Baseline actor ${entry.actor} changed signing keys inside one history.`);
    actorKeys.set(entry.actor, entry.signature.publicKey);
    if (
      !verify(
        null,
        Buffer.from(entry.entryHash, 'hex'),
        createPublicKey(entry.signature.publicKey),
        Buffer.from(entry.signature.value, 'base64'),
      )
    )
      throw new Error(`Baseline approval signature is invalid for ${entry.receipt.runId}.`);
    previousHash = entry.entryHash;
  }
  return history;
}

export function parseBaselineHistory(value: unknown): BaselineHistory {
  return verifyBaselineHistory(baselineHistorySchema.parse(value));
}

export function exportBaselineHistory(history: BaselineHistory): string {
  return `${canonicalJson(parseBaselineHistory(history))}\n`;
}

export function importBaselineHistory(text: string): BaselineHistory {
  return parseBaselineHistory(JSON.parse(text));
}

export async function importBaselineHistoryOrQuarantine(options: {
  text: string;
  sourcePath: string;
  quarantineRoot: string;
  quarantinedAt: string;
}): Promise<
  | { status: 'imported'; history: BaselineHistory }
  | {
      status: 'quarantined';
      quarantinePath: string;
      sourcePath: string;
      sha256: string;
      reason: string;
      quarantinedAt: string;
    }
> {
  try {
    return { status: 'imported', history: importBaselineHistory(options.text) };
  } catch (error) {
    const sha256 = createHash('sha256').update(options.text).digest('hex');
    const quarantinePath = resolve(
      options.quarantineRoot,
      `${basename(options.sourcePath)}.corrupt-${sha256.slice(0, 16)}.json`,
    );
    await mkdir(options.quarantineRoot, { recursive: true, mode: 0o700 });
    await writeFile(quarantinePath, options.text, { flag: 'wx', mode: 0o600 }).catch((writeError) => {
      if (!(writeError instanceof Error && 'code' in writeError && writeError.code === 'EEXIST')) throw writeError;
    });
    const reason =
      error instanceof z.ZodError
        ? `${error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('; ')}${error.issues.length > 3 ? `; +${error.issues.length - 3} more issue(s)` : ''}`
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      status: 'quarantined',
      quarantinePath,
      sourcePath: resolve(options.sourcePath),
      sha256,
      reason,
      quarantinedAt: options.quarantinedAt,
    };
  }
}

const compatible = (
  baseline: PerformanceRunReceipt,
  candidate: PerformanceRunReceipt,
  allowCrossHardware = false,
): boolean =>
  baseline.scenario.id === candidate.scenario.id &&
  baseline.scenario.version === candidate.scenario.version &&
  baseline.scenario.fixtureDigest === candidate.scenario.fixtureDigest &&
  baseline.scenario.cacheMode === candidate.scenario.cacheMode &&
  (allowCrossHardware || baseline.identity.hardware.classId === candidate.identity.hardware.classId) &&
  baseline.identity.build.profile === candidate.identity.build.profile;

export function appendApprovedBaseline(
  history: BaselineHistory | undefined,
  receipt: PerformanceRunReceipt,
  approval: { actor: string; reason: string; approvedAt: string; signingKey: KeyLike },
): BaselineHistory {
  const current = history === undefined ? { schemaVersion: 2 as const, entries: [] } : parseBaselineHistory(history);
  if (receipt.status !== 'pass') throw new Error('Only passing receipts can be approved as baselines.');
  if (approval.approvedAt < receipt.endedAt) throw new Error('A baseline cannot be approved before its run ended.');
  if (current.entries.some((entry) => entry.receipt.runId === receipt.runId))
    throw new Error('Baseline history contains a duplicate run ID.');
  const prior = current.entries.at(-1);
  if (prior !== undefined && approval.approvedAt < prior.approvedAt)
    throw new Error('Baseline approvals must remain append-ordered.');
  const privateKey =
    approval.signingKey instanceof KeyObject ? approval.signingKey : createPrivateKey(approval.signingKey);
  const publicKey = createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }).toString();
  const draft = {
    approvedAt: approval.approvedAt,
    actor: approval.actor,
    reason: approval.reason,
    source: { runId: receipt.runId, commit: receipt.identity.git.commit, receiptSha256: digest(receipt) },
    receipt,
    previousHash: prior?.entryHash ?? ('genesis' as const),
  };
  const entryHash = digest(draft);
  const entry = {
    ...draft,
    entryHash,
    signature: {
      algorithm: 'ed25519' as const,
      publicKey,
      value: sign(null, Buffer.from(entryHash, 'hex'), privateKey).toString('base64'),
    },
  };
  return parseBaselineHistory({ schemaVersion: 2, entries: [...current.entries, entry] });
}

export function selectApprovedBaseline(
  history: BaselineHistory,
  candidate: PerformanceRunReceipt,
  options: { allowCrossHardware?: boolean } = {},
): BaselineHistory['entries'][number] {
  verifyBaselineHistory(history);
  const eligible = history.entries
    .filter(
      (entry) =>
        entry.approvedAt <= candidate.startedAt &&
        compatible(entry.receipt, candidate, options.allowCrossHardware === true),
    )
    .sort((left, right) =>
      left.approvedAt === right.approvedAt
        ? left.receipt.runId.localeCompare(right.receipt.runId)
        : left.approvedAt.localeCompare(right.approvedAt),
    );
  const selected = eligible.at(-1);
  if (selected === undefined) throw new Error(`No approved compatible baseline exists for ${candidate.scenario.id}.`);
  return selected;
}

export function comparePerformanceTrend(
  history: BaselineHistory,
  candidate: PerformanceRunReceipt,
  budgets: PerformanceScenario['budgets'],
) {
  const selected = selectApprovedBaseline(history, candidate);
  const compatibleEntries = history.entries.filter(
    (entry) => entry.approvedAt <= candidate.startedAt && compatible(entry.receipt, candidate),
  );
  return {
    selectedBaselineRunId: selected.receipt.runId,
    points: compatibleEntries.map((entry) => ({
      approvedAt: entry.approvedAt,
      baselineRunId: entry.receipt.runId,
      comparison: comparePerformanceReceipts(entry.receipt, candidate, budgets),
    })),
  };
}
