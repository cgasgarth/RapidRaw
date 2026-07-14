import { lstat, readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { z } from 'zod';
import { processStartToken } from './identity';

export const nativeQaControlRecordSchema = z.object({
  schemaVersion: z.literal(1),
  pid: z.number().int().positive(),
  processStartToken: z.string().min(1),
  socketPath: z.string().startsWith('/'),
  token: z.string().min(32),
  logPath: z.string().startsWith('/'),
  identity: z.object({ worktree: z.string().min(1), build: z.string().min(1) }),
});

export type NativeQaControlRecord = z.infer<typeof nativeQaControlRecordSchema>;

export type NativeQaReadinessStatus = 'ready' | 'waiting' | 'exited';

/** Classify the launcher handshake so an exited bundle cannot be reported as healthy. */
export function nativeQaReadinessStatus(
  health: { readonly ready: boolean } | undefined,
  processAlive: boolean,
): NativeQaReadinessStatus {
  if (!processAlive) return 'exited';
  return health?.ready === true ? 'ready' : 'waiting';
}

export const NATIVE_QA_BINARY_MARKERS = [
  'RAWENGINE_QA_CONTROL_SOCKET',
  'rawengine-qa-control',
  'QA control authentication failed',
] as const;

export function verifyNativeQaBinaryBoundary(
  contents: Uint8Array,
  expectation: 'present' | 'absent',
): Array<{ marker: string; found: boolean }> {
  const buffer = Buffer.from(contents);
  const presence = NATIVE_QA_BINARY_MARKERS.map((marker) => ({ marker, found: buffer.includes(Buffer.from(marker)) }));
  const valid =
    expectation === 'present' ? presence.every(({ found }) => found) : presence.every(({ found }) => !found);
  if (!valid) throw new Error(`Native QA production boundary failed: ${JSON.stringify({ expectation, presence })}`);
  return presence;
}

const responseSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().nullable().optional(),
});

const nativeQaControlOperationSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('health') }).strict(),
  z.object({ method: z.literal('capabilities') }).strict(),
  z.object({ method: z.literal('reset'), mode: z.enum(['empty', 'library', 'editor']) }).strict(),
  z.object({ method: z.literal('openFixture'), path: z.string().startsWith('/') }).strict(),
  z.object({ method: z.literal('diagnostics') }).strict(),
  z.object({ method: z.literal('screenshot'), path: z.string().startsWith('/').endsWith('.png') }).strict(),
  z.object({ method: z.literal('setCacheMode'), mode: z.enum(['cold', 'warm']) }).strict(),
  z.object({ method: z.literal('shutdown') }).strict(),
]);

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TRANSIENT_ATTEMPTS = 8;
const transientBackoffMs = (attempt: number): number => Math.min(25 * 2 ** attempt, 250);

const isTransientTransportFailure = (error: unknown): error is Error =>
  error instanceof Error &&
  /(?:ECONNREFUSED|ECONNRESET|EAGAIN|ENOENT|EPIPE|Resource temporarily unavailable|closed before a response)/u.test(
    error.message,
  );

export async function readNativeQaControlRecord(path: string): Promise<NativeQaControlRecord | undefined> {
  try {
    return nativeQaControlRecordSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return undefined;
  }
}

export async function readLiveNativeQaControlRecord(
  path: string,
  expectedWorktree?: string,
): Promise<NativeQaControlRecord | undefined> {
  const record = await readNativeQaControlRecord(path);
  if (record === undefined || (expectedWorktree !== undefined && record.identity.worktree !== expectedWorktree))
    return undefined;
  const [recordStat, socketStat] = await Promise.all([
    lstat(path).catch(() => undefined),
    lstat(record.socketPath).catch(() => undefined),
  ]);
  if (
    recordStat === undefined ||
    (recordStat.mode & 0o077) !== 0 ||
    socketStat === undefined ||
    !socketStat.isSocket() ||
    (socketStat.mode & 0o077) !== 0 ||
    record.processStartToken !== (await processStartToken(record.pid))
  )
    return undefined;
  return record;
}

export async function requestNativeQaControl(
  record: NativeQaControlRecord,
  method: string,
  parameters: Readonly<Record<string, unknown>> = {},
  token = record.token,
): Promise<z.infer<typeof responseSchema>> {
  const id = crypto.randomUUID();
  for (const key of ['id', 'token', 'expectedIdentity', 'method'])
    if (Object.hasOwn(parameters, key)) throw new Error(`Native QA parameters cannot override reserved field ${key}.`);
  const operation = nativeQaControlOperationSchema.parse({ ...parameters, method });
  const request = () =>
    new Promise<z.infer<typeof responseSchema>>((resolveResponse, reject) => {
      const socket = connect(record.socketPath);
      let buffer = '';
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      socket.setEncoding('utf8');
      socket.setTimeout(60_000, () => socket.destroy(new Error(`Native QA ${method} timed out.`)));
      socket.once('connect', () =>
        socket.write(`${JSON.stringify({ id, token, expectedIdentity: record.identity, ...operation })}\n`),
      );
      socket.on('data', (chunk) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > MAX_RESPONSE_BYTES) {
          socket.destroy(new Error(`Native QA ${method} response exceeded ${MAX_RESPONSE_BYTES} bytes.`));
          return;
        }
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        settled = true;
        socket.end();
        try {
          const response = responseSchema.parse(JSON.parse(buffer.slice(0, newline)));
          if (response.id !== id) throw new Error(`Native QA response ID mismatch: ${response.id}`);
          resolveResponse(response);
        } catch (error) {
          reject(error);
        }
      });
      socket.once('end', () => fail(new Error(`Native QA ${method} transport closed before a response.`)));
      socket.once('close', () => fail(new Error(`Native QA ${method} transport closed before a response.`)));
      socket.once('error', fail);
    });
  const startedAt = performance.now();
  for (let attempt = 0; attempt < MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (!isTransientTransportFailure(error)) throw error;
      if (attempt + 1 === MAX_TRANSIENT_ATTEMPTS)
        throw new Error(
          `Native QA ${method} transport unavailable after ${MAX_TRANSIENT_ATTEMPTS} attempts in ${Math.round(performance.now() - startedAt)}ms: ${error.message}`,
          { cause: error },
        );
      await Bun.sleep(transientBackoffMs(attempt));
    }
  }
  throw new Error(`Native QA ${method} transport retry invariant failed.`);
}
