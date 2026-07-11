import { createServer } from 'node:net';

const MIN_PORT = 1;
const MAX_PORT = 65_535;

export function parseTcpPort(value: string, envName: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT || String(port) !== value.trim()) {
    throw new Error(`${envName} must be a valid TCP port.`);
  }
  return port;
}

export async function allocateFreeTcpPort(host: string, preferredPort?: number): Promise<number> {
  if (preferredPort !== undefined && (await canListen(host, preferredPort))) return preferredPort;

  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, host, () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }
        if (address === null || typeof address === 'string') {
          rejectPort(new Error('Unable to allocate a free TCP port.'));
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

async function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once('error', () => resolvePort(false));
    server.listen(port, host, () => {
      server.close(() => resolvePort(true));
    });
  });
}
