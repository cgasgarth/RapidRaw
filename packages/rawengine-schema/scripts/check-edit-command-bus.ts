import { EditCommandBus } from '../src/editCommandBus.js';
import { commandEnvelopeV1Schema } from '../src/rawEngineSchemas.js';
import { sampleCommandEnvelopeV1 } from '../src/samplePayloads.js';

const bus = new EditCommandBus();

interface CommandBusCheckResult {
  commandId: string;
  commandType: string;
  dryRun: boolean;
}

bus.register({
  commandType: sampleCommandEnvelopeV1.commandType,
  schema: commandEnvelopeV1Schema,
  execute: (command) => ({
    commandId: command.commandId,
    commandType: command.commandType,
    dryRun: command.dryRun,
  }),
});

const validResult = await bus.dispatch<CommandBusCheckResult>(sampleCommandEnvelopeV1);
if (!validResult.ok || validResult.result.commandId !== sampleCommandEnvelopeV1.commandId) {
  throw new Error('Expected valid command dispatch.');
}

const invalidResult = await bus.dispatch({ ...sampleCommandEnvelopeV1, commandType: '' });
if (invalidResult.ok || invalidResult.reason !== 'invalid_command') {
  throw new Error('Expected invalid command result for empty commandType.');
}

const unknownResult = await bus.dispatch({ ...sampleCommandEnvelopeV1, commandType: 'missing.command' });
if (unknownResult.ok || unknownResult.reason !== 'unknown_command') {
  throw new Error('Expected unknown command result.');
}

let duplicateRejected = false;
try {
  bus.register({
    commandType: sampleCommandEnvelopeV1.commandType,
    schema: commandEnvelopeV1Schema,
    execute: () => null,
  });
} catch {
  duplicateRejected = true;
}

if (!duplicateRejected) {
  throw new Error('Expected duplicate handler registration rejection.');
}

console.log(`edit command bus ok (${bus.listCommandTypes().length})`);
