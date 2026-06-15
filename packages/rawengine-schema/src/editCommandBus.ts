import { z } from 'zod';

const commandTypeProbeSchema = z.looseObject({
  commandType: z.string().trim().min(1),
});

export interface EditCommandBusContext {
  readonly now: () => Date;
  readonly requestId?: string;
}

export interface EditCommandHandler<TCommand extends { commandType: string }, TResult> {
  readonly commandType: TCommand['commandType'];
  readonly execute: (command: TCommand, context: EditCommandBusContext) => Promise<TResult> | TResult;
  readonly schema: z.ZodType<TCommand>;
}

export type EditCommandDispatchResult<TResult = unknown> =
  | {
      readonly commandType: string;
      readonly ok: true;
      readonly result: TResult;
    }
  | {
      readonly commandType?: string;
      readonly issues?: z.core.$ZodIssue[];
      readonly message: string;
      readonly ok: false;
      readonly reason: 'handler_failed' | 'invalid_command' | 'unknown_command';
    };

interface RegisteredEditCommandHandler {
  readonly execute: (command: unknown, context: EditCommandBusContext) => Promise<unknown>;
  readonly schema: z.ZodType;
}

export class EditCommandBus {
  readonly #handlers: Map<string, RegisteredEditCommandHandler> = new Map<string, RegisteredEditCommandHandler>();

  listCommandTypes(): Array<string> {
    return [...this.#handlers.keys()].sort();
  }

  register<TCommand extends { commandType: string }, TResult>(handler: EditCommandHandler<TCommand, TResult>): void {
    if (this.#handlers.has(handler.commandType)) {
      throw new Error(`Edit command handler already registered: ${handler.commandType}`);
    }

    this.#handlers.set(handler.commandType, {
      execute: async (command, context) => handler.execute(handler.schema.parse(command), context),
      schema: handler.schema,
    });
  }

  async dispatch<TResult = unknown>(
    command: unknown,
    context: EditCommandBusContext = { now: () => new Date() },
  ): Promise<EditCommandDispatchResult<TResult>> {
    const commandTypeResult = commandTypeProbeSchema.safeParse(command);
    if (!commandTypeResult.success) {
      return {
        issues: commandTypeResult.error.issues,
        message: 'Command envelope is missing a valid commandType.',
        ok: false,
        reason: 'invalid_command',
      };
    }

    const { commandType } = commandTypeResult.data;
    const handler = this.#handlers.get(commandType);
    if (!handler) {
      return {
        commandType,
        message: `No edit command handler registered for ${commandType}.`,
        ok: false,
        reason: 'unknown_command',
      };
    }

    const parseResult = handler.schema.safeParse(command);
    if (!parseResult.success) {
      return {
        commandType,
        issues: parseResult.error.issues,
        message: `Edit command ${commandType} failed schema validation.`,
        ok: false,
        reason: 'invalid_command',
      };
    }

    try {
      return {
        commandType,
        ok: true,
        result: (await handler.execute(parseResult.data, context)) as TResult,
      };
    } catch (error) {
      return {
        commandType,
        message: error instanceof Error ? error.message : String(error),
        ok: false,
        reason: 'handler_failed',
      };
    }
  }
}
