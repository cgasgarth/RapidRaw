import { type Child, Command } from '@tauri-apps/plugin-shell';
import { z } from 'zod';
import type {
  AgentSelectedImageModelTransport,
  AgentSelectedImageModelTurnRequest,
  AgentSelectedImageModelTurnResponse,
} from './agentSelectedImageModelToolLoop';
import { agentSelectedImageModelOutputSchema } from './agentSelectedImageModelToolSchemas';

const rpcResponseSchema = z
  .object({ error: z.unknown().optional(), id: z.number().int(), result: z.unknown().optional() })
  .passthrough();
const threadStartResultSchema = z
  .object({ model: z.string(), modelProvider: z.string(), thread: z.object({ id: z.string() }).passthrough() })
  .passthrough();
const turnStartResultSchema = z.object({ turn: z.object({ id: z.string() }).passthrough() }).passthrough();
const turnCompletedSchema = z
  .object({
    method: z.literal('turn/completed'),
    params: z
      .object({
        threadId: z.string(),
        turn: z
          .object({ error: z.unknown().nullable(), id: z.string(), items: z.array(z.unknown()), status: z.string() })
          .passthrough(),
      })
      .strict(),
  })
  .passthrough();
const agentMessageSchema = z
  .object({ id: z.string(), text: z.string(), type: z.literal('agentMessage') })
  .passthrough();

const outputSchema = {
  oneOf: [
    {
      additionalProperties: false,
      properties: {
        decision: { const: 'call_tool' },
        rationale: { maxLength: 2048, type: 'string' },
        tool: {
          additionalProperties: false,
          properties: {
            arguments: {
              additionalProperties: false,
              properties: {
                patch: {
                  additionalProperties: false,
                  minProperties: 1,
                  properties: {
                    blacks: { maximum: 100, minimum: -100, type: 'number' },
                    clarity: { maximum: 100, minimum: -100, type: 'number' },
                    contrast: { maximum: 100, minimum: -100, type: 'number' },
                    exposure: { maximum: 2, minimum: -2, type: 'number' },
                    highlights: { maximum: 100, minimum: -100, type: 'number' },
                    saturation: { maximum: 100, minimum: -100, type: 'number' },
                    shadows: { maximum: 100, minimum: -100, type: 'number' },
                    whites: { maximum: 100, minimum: -100, type: 'number' },
                  },
                  type: 'object',
                },
              },
              required: ['patch'],
              type: 'object',
            },
            callId: { minLength: 1, type: 'string' },
            name: { const: 'proposal_render' },
          },
          required: ['arguments', 'callId', 'name'],
          type: 'object',
        },
      },
      required: ['decision', 'tool'],
      type: 'object',
    },
    {
      additionalProperties: false,
      properties: {
        decision: { const: 'finalize_proposal' },
        proposalId: { minLength: 1, type: 'string' },
        rationale: { maxLength: 2048, type: 'string' },
      },
      required: ['decision', 'proposalId'],
      type: 'object',
    },
    {
      additionalProperties: false,
      properties: { decision: { const: 'clarification_required' }, message: { minLength: 1, type: 'string' } },
      required: ['decision', 'message'],
      type: 'object',
    },
    {
      additionalProperties: false,
      properties: {
        decision: { const: 'stop' },
        message: { minLength: 1, type: 'string' },
        reason: { enum: ['policy_refusal', 'unsupported_request', 'user_request'] },
      },
      required: ['decision', 'message', 'reason'],
      type: 'object',
    },
  ],
};

type PendingRpc = { reject: (error: Error) => void; resolve: (value: unknown) => void };
type PendingTurn = { reject: (error: Error) => void; resolve: (value: z.infer<typeof turnCompletedSchema>) => void };

export class AgentCodexAppServerModelTransport implements AgentSelectedImageModelTransport {
  private child: Child | undefined;
  private nextId = 1;
  private readonly pendingRpc = new Map<number, PendingRpc>();
  private readonly pendingTurns = new Map<string, PendingTurn>();
  private threadId: string | undefined;
  private modelId: string;
  private provider = 'unknown';

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.threadId = undefined;
    if (child !== undefined) await child.kill().catch(() => undefined);
    const error = new Error('Codex app-server transport closed.');
    for (const pending of this.pendingRpc.values()) pending.reject(error);
    for (const pending of this.pendingTurns.values()) pending.reject(error);
    this.pendingRpc.clear();
    this.pendingTurns.clear();
  }

  async runTurn(
    request: AgentSelectedImageModelTurnRequest,
    signal: AbortSignal,
  ): Promise<AgentSelectedImageModelTurnResponse> {
    await this.ensureStarted();
    const threadId = this.threadId;
    if (threadId === undefined) throw new Error('Codex app-server thread was not initialized.');
    const input: unknown[] = [{ type: 'text', text: request.prompt, text_elements: [] }];
    if (request.lineageHead !== undefined)
      input.push({
        type: 'text',
        text: `Runtime-verified current proposal: ${JSON.stringify(request.lineageHead)}`,
        text_elements: [],
      });
    if (request.attachment !== undefined)
      input.push({ type: 'image', detail: 'high', url: request.attachment.dataUrl });
    const abort = () => {
      void this.close();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const started = turnStartResultSchema.parse(
        await this.rpc('turn/start', {
          approvalPolicy: 'never',
          input,
          model: this.modelId,
          outputSchema,
          sandboxPolicy: { networkAccess: false, type: 'readOnly' },
          threadId,
        }),
      );
      const completed = await new Promise<z.infer<typeof turnCompletedSchema>>((resolve, reject) => {
        this.pendingTurns.set(started.turn.id, { reject, resolve });
      });
      if (completed.params.turn.status !== 'completed') throw new Error('Codex model turn did not complete.');
      const messages = completed.params.turn.items
        .map((item) => agentMessageSchema.safeParse(item))
        .filter((item) => item.success);
      const message = messages.at(-1)?.data;
      if (message === undefined) throw new Error('Codex model turn returned no final agent message.');
      const output = agentSelectedImageModelOutputSchema.parse(JSON.parse(message.text));
      return {
        modelId: this.modelId,
        modelTurnId: completed.params.turn.id,
        output,
        provider: this.provider,
        providerVersion: 'codex-app-server-v2',
      };
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.child !== undefined) return;
    const command = Command.create('codex', ['app-server', '--stdio']);
    command.stdout.on('data', (line) => this.onLine(line));
    command.stderr.on('data', () => undefined);
    command.on('error', (message) => {
      void this.failAll(new Error(message));
    });
    command.on('close', () => {
      void this.failAll(new Error('Codex app-server exited.'));
    });
    this.child = await command.spawn();
    await this.rpc('initialize', {
      capabilities: null,
      clientInfo: { name: 'rapidraw', title: 'RapidRAW', version: '1.0.0' },
    });
    const started = threadStartResultSchema.parse(
      await this.rpc('thread/start', {
        approvalPolicy: 'never',
        baseInstructions:
          'You are the selected-image proposal model. Never invoke tools or describe a mutation as completed. Return only the supplied JSON output schema. Use proposal_render for a non-mutating basic-tone proposal, then finalize only the exact runtime-verified current proposalId.',
        ephemeral: true,
        model: this.modelId,
        sandbox: 'read-only',
      }),
    );
    this.threadId = started.thread.id;
    this.modelId = started.model;
    this.provider = started.modelProvider;
  }

  private async rpc(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    if (child === undefined) throw new Error('Codex app-server process is unavailable.');
    const id = this.nextId++;
    const response = new Promise<unknown>((resolve, reject) => this.pendingRpc.set(id, { reject, resolve }));
    await child.write(`${JSON.stringify({ id, method, params })}\n`);
    return response;
  }

  private onLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    const response = rpcResponseSchema.safeParse(value);
    if (response.success) {
      const pending = this.pendingRpc.get(response.data.id);
      if (pending === undefined) return;
      this.pendingRpc.delete(response.data.id);
      if (response.data.error !== undefined)
        pending.reject(new Error(`Codex app-server RPC failed: ${JSON.stringify(response.data.error)}`));
      else pending.resolve(response.data.result);
      return;
    }
    const completed = turnCompletedSchema.safeParse(value);
    if (!completed.success) return;
    const pending = this.pendingTurns.get(completed.data.params.turn.id);
    if (pending === undefined) return;
    this.pendingTurns.delete(completed.data.params.turn.id);
    pending.resolve(completed.data);
  }

  private async failAll(error: Error): Promise<void> {
    for (const pending of this.pendingRpc.values()) pending.reject(error);
    for (const pending of this.pendingTurns.values()) pending.reject(error);
    this.pendingRpc.clear();
    this.pendingTurns.clear();
    this.child = undefined;
  }
}

type AgentSelectedImageModelTransportFactory = (modelId: string) => AgentSelectedImageModelTransport;
let testTransportFactory: AgentSelectedImageModelTransportFactory | undefined;

export const createAgentSelectedImageModelTransport = (modelId: string): AgentSelectedImageModelTransport =>
  testTransportFactory?.(modelId) ?? new AgentCodexAppServerModelTransport(modelId);

export const setAgentSelectedImageModelTransportFactoryForTest = (
  factory: AgentSelectedImageModelTransportFactory | undefined,
): void => {
  testTransportFactory = factory;
};
