import { afterEach, describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { allocateFreeTcpPort, parseTcpPort } from '../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const openServers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error) rejectClose(error);
            else resolveClose();
          });
        }),
    ),
  );
});

describe('dev-server port allocation', () => {
  test('parses explicit TCP port overrides strictly', () => {
    expect(parseTcpPort('1420', 'TEST_PORT')).toBe(1420);
    expect(() => parseTcpPort('0', 'TEST_PORT')).toThrow('TEST_PORT must be a valid TCP port.');
    expect(() => parseTcpPort('65536', 'TEST_PORT')).toThrow('TEST_PORT must be a valid TCP port.');
    expect(() => parseTcpPort('01420', 'TEST_PORT')).toThrow('TEST_PORT must be a valid TCP port.');
  });

  test('uses the preferred port when available', async () => {
    const preferredPort = await allocateFreeTcpPort(host);

    await expect(allocateFreeTcpPort(host, preferredPort)).resolves.toBe(preferredPort);
  });

  test('falls back when the preferred port is already occupied', async () => {
    const preferredPort = await allocateFreeTcpPort(host);
    const server = createServer();
    openServers.push(server);
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(preferredPort, host, () => resolveListen());
    });

    const fallbackPort = await allocateFreeTcpPort(host, preferredPort);

    expect(fallbackPort).not.toBe(preferredPort);
    expect(fallbackPort).toBeGreaterThan(0);
  });
});
