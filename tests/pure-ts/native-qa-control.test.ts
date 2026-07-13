import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import { processStartToken } from '../../scripts/qa/identity';
import {
  NATIVE_QA_BINARY_MARKERS,
  type NativeQaControlRecord,
  nativeQaControlRecordSchema,
  readLiveNativeQaControlRecord,
  requestNativeQaControl,
  verifyNativeQaBinaryBoundary,
} from '../../scripts/qa/native-control';
import { nativeQaOpenFixturePayloadSchema, nativeQaResetPayloadSchema } from '../../src/schemas/tauriEventSchemas';
import { applyNativeQaOpenFixture, applyNativeQaReset } from '../../src/utils/nativeQaControlEvents';
import { NATIVE_QA_OPEN_FIXTURE_EVENT, NATIVE_QA_RESET_EVENT } from '../../src/utils/tauriEventNames';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('native QA control contracts', () => {
  test('requires a private token and exact worktree/build identity record', () => {
    expect(() =>
      nativeQaControlRecordSchema.parse({
        schemaVersion: 1,
        pid: 12,
        processStartToken: 'unknown',
        socketPath: '/tmp/control.sock',
        token: 'short',
        logPath: '/tmp/native.log',
        identity: { worktree: '/repo', build: 'build-1' },
      }),
    ).toThrow();
    expect(
      nativeQaControlRecordSchema.parse({
        schemaVersion: 1,
        pid: 12,
        processStartToken: 'unknown',
        socketPath: '/tmp/control.sock',
        token: 'a'.repeat(64),
        logPath: '/tmp/native.log',
        identity: { worktree: '/repo', build: 'build-1' },
      }).identity,
    ).toEqual({ worktree: '/repo', build: 'build-1' });
  });

  test('proves control symbols present only in validation binaries', () => {
    const validation = Buffer.from(NATIVE_QA_BINARY_MARKERS.join('\0'));
    expect(verifyNativeQaBinaryBoundary(validation, 'present').every(({ found }) => found)).toBe(true);
    expect(verifyNativeQaBinaryBoundary(Buffer.from('production binary'), 'absent').every(({ found }) => !found)).toBe(
      true,
    );
    expect(() => verifyNativeQaBinaryBoundary(validation, 'absent')).toThrow('production boundary');
  });

  test('sends authenticated identity-bound JSON over a local Unix socket', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'rapidraw-native-control-'));
    directories.push(directory);
    const socketPath = resolve(directory, 'control.sock');
    const record: NativeQaControlRecord = {
      schemaVersion: 1,
      pid: process.pid,
      processStartToken: (await processStartToken(process.pid)) ?? 'unavailable',
      socketPath,
      token: 'a'.repeat(64),
      logPath: '/tmp/native.log',
      identity: { worktree: '/repo', build: 'build-1' },
    };
    let received: unknown;
    let mismatchNextResponse = false;
    const requestSchema = z.object({ id: z.string(), mode: z.string().optional() }).passthrough();
    const server = createServer((socket) => {
      socket.setEncoding('utf8');
      socket.once('data', (line) => {
        received = requestSchema.parse(JSON.parse(String(line).trim()));
        const request = requestSchema.parse(received);
        socket.end(
          `${JSON.stringify({
            id: mismatchNextResponse ? 'wrong-id' : request.id,
            ok: true,
            result: { ready: true },
            error: null,
          })}\n`,
        );
        mismatchNextResponse = false;
      });
    });
    await new Promise<void>((ready) => server.listen(socketPath, ready));
    await chmod(socketPath, 0o600);
    const recordPath = resolve(directory, 'control.json');
    await writeFile(recordPath, JSON.stringify(record), { mode: 0o600 });
    try {
      expect(await readLiveNativeQaControlRecord(recordPath, '/repo')).toEqual(record);
      await writeFile(recordPath, JSON.stringify({ ...record, processStartToken: 'reused-pid' }), { mode: 0o600 });
      expect(await readLiveNativeQaControlRecord(recordPath, '/repo')).toBeUndefined();
      await writeFile(recordPath, JSON.stringify(record), { mode: 0o600 });
      await chmod(recordPath, 0o644);
      expect(await readLiveNativeQaControlRecord(recordPath, '/repo')).toBeUndefined();
      await chmod(recordPath, 0o600);
      const response = await requestNativeQaControl(record, 'setCacheMode', { mode: 'cold' });
      expect(response).toMatchObject({ ok: true, result: { ready: true }, error: null });
      expect(received).toMatchObject({
        token: record.token,
        expectedIdentity: record.identity,
        method: 'setCacheMode',
        mode: 'cold',
      });
      await expect(requestNativeQaControl(record, 'health', { token: 'attacker' })).rejects.toThrow();
      await expect(requestNativeQaControl(record, 'health', { method: 'shutdown' })).rejects.toThrow(
        'reserved field method',
      );
      mismatchNextResponse = true;
      await expect(requestNativeQaControl(record, 'health')).rejects.toThrow('response ID mismatch');
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  test('retries a bounded transient listener-startup refusal', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'rapidraw-native-control-retry-'));
    directories.push(directory);
    const socketPath = resolve(directory, 'control.sock');
    const record: NativeQaControlRecord = {
      schemaVersion: 1,
      pid: process.pid,
      processStartToken: (await processStartToken(process.pid)) ?? 'unavailable',
      socketPath,
      token: 'b'.repeat(64),
      logPath: '/tmp/native-retry.log',
      identity: { worktree: '/repo', build: 'build-retry' },
    };
    const pending = requestNativeQaControl(record, 'health');
    await Bun.sleep(5);
    const server = createServer((socket) => {
      socket.setEncoding('utf8');
      socket.once('data', (line) => {
        const request = z
          .object({ id: z.string() })
          .passthrough()
          .parse(JSON.parse(String(line).trim()));
        socket.end(`${JSON.stringify({ id: request.id, ok: true, result: { ready: true }, error: null })}\n`);
      });
    });
    await new Promise<void>((ready) => server.listen(socketPath, ready));
    try {
      await expect(pending).resolves.toMatchObject({ ok: true, result: { ready: true } });
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  test('recovers when accepted transports close before a response', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'rapidraw-native-control-early-close-'));
    directories.push(directory);
    const socketPath = resolve(directory, 'control.sock');
    const record: NativeQaControlRecord = {
      schemaVersion: 1,
      pid: process.pid,
      processStartToken: (await processStartToken(process.pid)) ?? 'unavailable',
      socketPath,
      token: 'c'.repeat(64),
      logPath: '/tmp/native-early-close.log',
      identity: { worktree: '/repo', build: 'build-early-close' },
    };
    let connections = 0;
    const server = createServer((socket) => {
      connections += 1;
      if (connections <= 3) {
        socket.end();
        return;
      }
      socket.setEncoding('utf8');
      socket.once('data', (line) => {
        const request = z
          .object({ id: z.string() })
          .passthrough()
          .parse(JSON.parse(String(line).trim()));
        socket.end(`${JSON.stringify({ id: request.id, ok: true, result: { ready: true }, error: null })}\n`);
      });
    });
    await new Promise<void>((ready) => server.listen(socketPath, ready));
    try {
      await expect(requestNativeQaControl(record, 'health')).resolves.toMatchObject({
        ok: true,
        result: { ready: true },
      });
      expect(connections).toBe(4);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  test('defines reset modes and the inert production frontend event contract', () => {
    expect(NATIVE_QA_RESET_EVENT).toBe('rawengine-qa-reset');
    expect(NATIVE_QA_OPEN_FIXTURE_EVENT).toBe('rawengine-qa-open-fixture');
    expect(
      nativeQaResetPayloadSchema.parse({ mode: 'editor', sessionRevision: 4, sourcePath: '/fixture.ARW' }),
    ).toEqual({
      mode: 'editor',
      sessionRevision: 4,
      sourcePath: '/fixture.ARW',
    });
    expect(() => nativeQaResetPayloadSchema.parse({ mode: 'unknown', sessionRevision: 0, sourcePath: null })).toThrow();
    expect(nativeQaOpenFixturePayloadSchema.parse({ path: '/fixture.ARW', sessionRevision: 5 })).toEqual({
      path: '/fixture.ARW',
      sessionRevision: 5,
    });
  });

  test('resets before forced editor/fixture reopen and keeps empty/library deterministic', () => {
    const events: string[] = [];
    const navigation = {
      openImagePath: (path: string) => events.push(`open:${path}`),
      resetToEmpty: () => events.push('empty'),
      resetToLibrary: () => events.push('library'),
    };
    const immediate = (operation: () => void) => operation();
    applyNativeQaReset({ mode: 'empty', sessionRevision: 1, sourcePath: null }, navigation, immediate);
    applyNativeQaReset({ mode: 'library', sessionRevision: 2, sourcePath: null }, navigation, immediate);
    applyNativeQaReset({ mode: 'editor', sessionRevision: 3, sourcePath: '/same.ARW' }, navigation, immediate);
    applyNativeQaOpenFixture({ path: '/fixture.ARW', sessionRevision: 4 }, navigation, immediate);
    expect(events).toEqual(['empty', 'library', 'library', 'open:/same.ARW', 'library', 'open:/fixture.ARW']);
  });
});
