import { describe, expect, test } from 'bun:test';

import { EditCommandBus } from '../../../packages/rawengine-schema/src/editCommandBus.ts';
import { commandEnvelopeV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleCommandEnvelopeV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const createBus = () => {
  const bus = new EditCommandBus();

  bus.register({
    commandType: sampleCommandEnvelopeV1.commandType,
    schema: commandEnvelopeV1Schema,
    execute: (command) => ({
      commandId: command.commandId,
      commandType: command.commandType,
      dryRun: command.dryRun,
    }),
  });

  return bus;
};

describe('EditCommandBus', () => {
  test('dispatches a valid schema-backed command', async () => {
    const result = await createBus().dispatch(sampleCommandEnvelopeV1);

    expect(result).toMatchObject({
      commandType: sampleCommandEnvelopeV1.commandType,
      ok: true,
      result: {
        commandId: sampleCommandEnvelopeV1.commandId,
        commandType: sampleCommandEnvelopeV1.commandType,
        dryRun: sampleCommandEnvelopeV1.dryRun,
      },
    });
  });

  test('returns invalid_command for malformed command envelopes', async () => {
    const result = await createBus().dispatch({ ...sampleCommandEnvelopeV1, commandType: '' });

    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid_command',
    });
  });

  test('returns unknown_command for unregistered command types', async () => {
    const result = await createBus().dispatch({ ...sampleCommandEnvelopeV1, commandType: 'missing.command' });

    expect(result).toMatchObject({
      commandType: 'missing.command',
      ok: false,
      reason: 'unknown_command',
    });
  });

  test('rejects duplicate handler registration', () => {
    const bus = createBus();

    expect(() => {
      bus.register({
        commandType: sampleCommandEnvelopeV1.commandType,
        schema: commandEnvelopeV1Schema,
        execute: () => null,
      });
    }).toThrow('already registered');
  });
});
