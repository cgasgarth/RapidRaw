import { beforeEach, describe, expect, mock, test } from 'bun:test';

const calls: Array<{ args: unknown; command: string }> = [];
const invoke = mock(async (command: string, args: unknown) => {
  calls.push({ args, command });
  if (command === 'start_background_indexing') return { generation: 3, operationId: 4 };
  if (command === 'cancel_background_indexing') return true;
  throw new Error(`Unexpected command: ${command}`);
});
mock.module('@tauri-apps/api/core', () => ({ invoke }));

const { cancelBackgroundIndexingWithSchema, startBackgroundIndexingWithSchema } = await import(
  '../../../src/utils/catalogIndexingInvokes'
);

describe('catalog indexing invoke boundary', () => {
  beforeEach(() => {
    calls.length = 0;
    invoke.mockClear();
  });

  test('start returns the typed native authority', async () => {
    await expect(startBackgroundIndexingWithSchema('/catalog')).resolves.toEqual({ generation: 3, operationId: 4 });
    expect(calls).toEqual([{ args: { folderPath: '/catalog' }, command: 'start_background_indexing' }]);
  });

  test('cancel carries the exact nested authority expected by native IPC', async () => {
    await expect(cancelBackgroundIndexingWithSchema({ generation: 3, operationId: 4 })).resolves.toBeTrue();
    expect(calls).toEqual([
      {
        args: { authority: { generation: 3, operationId: 4 } },
        command: 'cancel_background_indexing',
      },
    ]);
  });
});
