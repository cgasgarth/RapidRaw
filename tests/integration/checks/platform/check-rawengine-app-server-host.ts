#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { sampleToneColorCommandEnvelopeV1 } from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  RawEngineAppServerHostToolName,
  RawEngineAppServerLifecyclePhase,
  RawEngineAppServerProtocol,
  RawEngineAppServerResponseStatus,
  RawEngineAppServerStructuredErrorCode,
  RawEngineAppServerSupervisorEventKind,
  RawEngineAppServerSupervisorPhase,
  RawEngineAppServerToolKind,
  RawEngineAppServerTransport,
  rawEngineAppServerCapabilitiesReplaySchema,
  rawEngineAppServerHealthReplaySchema,
  rawEngineAppServerHostManifestSchema,
  rawEngineAppServerHostResponseEnvelopeSchema,
  rawEngineAppServerLifecycleReplaySchema,
  rawEngineAppServerRouteCatalogReplaySchema,
  rawEngineAppServerSupervisorStateSchema,
} from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import {
  assertRawEngineAppServerLifecycleReady,
  buildRawEngineAppServerCapabilitiesReplay,
  buildRawEngineAppServerHealthReplay,
  buildRawEngineAppServerHostResponseEnvelope,
  buildRawEngineAppServerHostResponseEnvelopeAsync,
  buildRawEngineAppServerLifecycleReplay,
  buildRawEngineAppServerRouteCatalogReplay,
  cancelRawEngineAppServerSupervisor,
  createRawEngineAppServerLifecycleState,
  createRawEngineAppServerSupervisorState,
  failRawEngineAppServerSupervisor,
  handleRawEngineAppServerHostRequest,
  handleRawEngineAppServerHostRequestAsync,
  initializeRawEngineAppServerLifecycle,
  markRawEngineAppServerSupervisorReady,
  RAW_ENGINE_APP_SERVER_HOST_MANIFEST,
  startRawEngineAppServerSupervisor,
  stopRawEngineAppServerLifecycle,
  stopRawEngineAppServerSupervisor,
} from '../../../../src/utils/rawEngineAppServerHost.ts';

const failures = [];
const manifest = rawEngineAppServerHostManifestSchema.parse(RAW_ENGINE_APP_SERVER_HOST_MANIFEST);
const healthTool = manifest.tools.find((tool) => tool.toolName === RawEngineAppServerHostToolName.Health);
const capabilitiesTool = manifest.tools.find((tool) => tool.toolName === RawEngineAppServerHostToolName.Capabilities);
const routeCatalogTool = manifest.tools.find((tool) => tool.toolName === RawEngineAppServerHostToolName.RouteCatalog);
const dispatchTool = manifest.tools.find((tool) => tool.toolName === RawEngineAppServerHostToolName.DispatchTool);
const clientInfo = {
  name: 'rawengine_desktop',
  title: 'RawEngine Desktop',
  version: '0.1.0',
};
const fixtureResponseSchema = z
  .object({
    id: z.literal(1),
    result: z
      .object({
        protocol: z.literal(RawEngineAppServerProtocol.CodexAppServer),
        ready: z.literal(true),
        transport: z.literal(RawEngineAppServerTransport.StdioJsonl),
      })
      .strict(),
  })
  .strict();
const fixtureThreadNotificationSchema = z
  .object({
    method: z.literal('thread/started'),
    params: z
      .object({
        thread: z
          .object({
            id: z.string().trim().min(1),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
const fixtureDispatchEnvelopeSchema = rawEngineAppServerHostResponseEnvelopeSchema.extend({
  request: z.object({ runtimeToolName: z.literal('tonecolor.dry_run_command') }).passthrough(),
  response: z
    .object({ dispatchStatus: z.literal('completed'), runtimeToolName: z.literal('tonecolor.dry_run_command') })
    .passthrough(),
});
const dispatchRequest = {
  arguments: sampleToneColorCommandEnvelopeV1,
  requestId: 'dispatch_tonecolor_dry_run_001',
  runtimeToolName: 'tonecolor.dry_run_command',
  toolName: RawEngineAppServerHostToolName.DispatchTool,
};

const lifecycleCreated = createRawEngineAppServerLifecycleState({ connectionId: 'conn_stdio_001' });
try {
  assertRawEngineAppServerLifecycleReady(lifecycleCreated);
  failures.push('Created lifecycle state must reject host requests before initialize.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('created')) {
    failures.push('Created lifecycle rejection should include phase.');
  }
}

const lifecycleInitialized = initializeRawEngineAppServerLifecycle({
  clientInfo,
  state: lifecycleCreated,
  timestampIso: '2026-06-17T12:00:00.000Z',
});
assertRawEngineAppServerLifecycleReady(lifecycleInitialized);
try {
  initializeRawEngineAppServerLifecycle({
    clientInfo,
    state: lifecycleInitialized,
    timestampIso: '2026-06-17T12:01:00.000Z',
  });
  failures.push('Lifecycle must reject repeated initialize.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('initialized')) {
    failures.push('Repeated initialize rejection should include phase.');
  }
}

const lifecycleStopped = stopRawEngineAppServerLifecycle({
  state: lifecycleInitialized,
  timestampIso: '2026-06-17T12:02:00.000Z',
});
try {
  assertRawEngineAppServerLifecycleReady(lifecycleStopped);
  failures.push('Stopped lifecycle state must reject host requests.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('stopped')) {
    failures.push('Stopped lifecycle rejection should include phase.');
  }
}

const lifecycleReplay = rawEngineAppServerLifecycleReplaySchema.parse(
  buildRawEngineAppServerLifecycleReplay({
    clientInfo,
    connectionId: 'conn_stdio_replay_001',
    createdAtIso: '2026-06-17T11:59:59.000Z',
    initializedAtIso: '2026-06-17T12:00:00.000Z',
    stoppedAtIso: '2026-06-17T12:02:00.000Z',
  }),
);

if (lifecycleReplay.finalState.phase !== RawEngineAppServerLifecyclePhase.Stopped) {
  failures.push('Lifecycle replay must finish stopped.');
}
if (
  lifecycleReplay.events.map((event) => event.phase).join(',') !==
  [
    RawEngineAppServerLifecyclePhase.Created,
    RawEngineAppServerLifecyclePhase.Initialized,
    RawEngineAppServerLifecyclePhase.Stopped,
  ].join(',')
) {
  failures.push('Lifecycle replay phase order mismatch.');
}

const supervisorCreated = createRawEngineAppServerSupervisorState({
  command: ['codex', 'app-server', '--stdio'],
  supervisorId: 'supervisor_stdio_001',
  timestampIso: '2026-06-17T12:00:00.000Z',
});
const supervisorStarting = startRawEngineAppServerSupervisor({
  processId: 4242,
  state: supervisorCreated,
  timestampIso: '2026-06-17T12:00:01.000Z',
});
const supervisorRunning = markRawEngineAppServerSupervisorReady({
  state: supervisorStarting,
  timestampIso: '2026-06-17T12:00:02.000Z',
});
const supervisorCancelling = cancelRawEngineAppServerSupervisor({
  state: supervisorRunning,
  timestampIso: '2026-06-17T12:00:03.000Z',
});
const supervisorStopped = rawEngineAppServerSupervisorStateSchema.parse(
  stopRawEngineAppServerSupervisor({
    state: supervisorCancelling,
    timestampIso: '2026-06-17T12:00:04.000Z',
  }),
);

if (supervisorStopped.phase !== RawEngineAppServerSupervisorPhase.Stopped) {
  failures.push('Supervisor stop should finish stopped.');
}
if (supervisorStopped.processId !== null) failures.push('Supervisor stop must clear processId.');
if (supervisorStopped.cancellationRequestedAtIso === null) {
  failures.push('Supervisor cancellation should remain audit-visible after stop.');
}
if (
  supervisorStopped.auditEvents.map((event) => event.kind).join(',') !==
  [
    RawEngineAppServerSupervisorEventKind.Created,
    RawEngineAppServerSupervisorEventKind.Start,
    RawEngineAppServerSupervisorEventKind.Ready,
    RawEngineAppServerSupervisorEventKind.Cancel,
    RawEngineAppServerSupervisorEventKind.Stop,
  ].join(',')
) {
  failures.push('Supervisor audit event order mismatch.');
}

const supervisorFailed = failRawEngineAppServerSupervisor({
  error: {
    code: RawEngineAppServerStructuredErrorCode.HealthTimeout,
    message: 'App-server health check did not report initialized before timeout.',
    recoverable: true,
  },
  state: supervisorStarting,
  timestampIso: '2026-06-17T12:00:05.000Z',
});
if (supervisorFailed.error?.code !== RawEngineAppServerStructuredErrorCode.HealthTimeout)
  failures.push('Supervisor failure should keep structured error.');
if (!supervisorFailed.auditEvents.some((event) => event.kind === RawEngineAppServerSupervisorEventKind.Fail)) {
  failures.push('Supervisor failure should append fail event.');
}

try {
  startRawEngineAppServerSupervisor({
    processId: 4343,
    state: supervisorRunning,
    timestampIso: '2026-06-17T12:00:06.000Z',
  });
  failures.push('Supervisor must reject start while running.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('running')) {
    failures.push('Supervisor start rejection should include current phase.');
  }
}

const runStdioLaunchProof = async () => {
  let state = createRawEngineAppServerSupervisorState({
    command: ['bun', 'scripts/fixtures/rawengine-app-server-stdio-fixture.ts'],
    supervisorId: 'supervisor_stdio_launch_001',
    timestampIso: '2026-06-17T12:03:00.000Z',
  });

  const proc = Bun.spawn(state.command, {
    stderr: 'pipe',
    stdin: 'pipe',
    stdout: 'pipe',
  });

  state = startRawEngineAppServerSupervisor({
    processId: proc.pid,
    state,
    timestampIso: '2026-06-17T12:03:01.000Z',
  });

  proc.stdin.write(
    `${JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo },
    })}\n`,
  );
  proc.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
  proc.stdin.write(`${JSON.stringify(dispatchRequest)}\n`);
  proc.stdin.end();

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  const stdout = await stdoutPromise;
  const stderr = await stderrPromise;

  if (exitCode !== 0) {
    return failRawEngineAppServerSupervisor({
      error: {
        code: 'unexpected_exit',
        message: `stdio fixture exited ${exitCode}: ${stderr.trim()}`,
        recoverable: true,
      },
      state,
      timestampIso: '2026-06-17T12:03:02.000Z',
    });
  }

  const responseLines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const initializeResponseLine = responseLines[0];
  const threadStartedLine = responseLines[1];
  const dispatchEnvelopeLine = responseLines[2];

  if (initializeResponseLine === undefined || threadStartedLine === undefined || dispatchEnvelopeLine === undefined) {
    return failRawEngineAppServerSupervisor({
      error: {
        code: RawEngineAppServerStructuredErrorCode.HealthTimeout,
        message: 'stdio fixture did not emit initialize response, thread notification, and dispatch envelope.',
        recoverable: true,
      },
      state,
      timestampIso: '2026-06-17T12:03:02.000Z',
    });
  }

  fixtureResponseSchema.parse(JSON.parse(initializeResponseLine));
  fixtureThreadNotificationSchema.parse(JSON.parse(threadStartedLine));
  fixtureDispatchEnvelopeSchema.parse(JSON.parse(dispatchEnvelopeLine));
  const running = markRawEngineAppServerSupervisorReady({
    state,
    timestampIso: '2026-06-17T12:03:02.000Z',
  });

  return stopRawEngineAppServerSupervisor({
    state: running,
    timestampIso: '2026-06-17T12:03:03.000Z',
  });
};

const launchProof = rawEngineAppServerSupervisorStateSchema.parse(await runStdioLaunchProof());
if (launchProof.phase !== RawEngineAppServerSupervisorPhase.Stopped) {
  failures.push('Executable stdio launch proof must finish stopped.');
}
if (launchProof.error !== null) failures.push(`Executable stdio launch proof failed: ${launchProof.error.message}`);
if (launchProof.auditEvents.map((event) => event.kind).join(',') !== 'created,start,ready,stop') {
  failures.push('Executable stdio launch proof audit event order mismatch.');
}

if (healthTool === undefined) {
  failures.push(`Missing ${RawEngineAppServerHostToolName.Health} tool.`);
} else {
  if (healthTool.mutates) failures.push('Health tool must be read-only.');
  if (healthTool.toolKind !== RawEngineAppServerToolKind.Read) failures.push('Health tool must use read kind.');
}

if (capabilitiesTool === undefined) {
  failures.push(`Missing ${RawEngineAppServerHostToolName.Capabilities} tool.`);
} else {
  if (capabilitiesTool.mutates) failures.push('Capabilities tool must be read-only.');
  if (capabilitiesTool.toolKind !== RawEngineAppServerToolKind.Read) {
    failures.push('Capabilities tool must use read kind.');
  }
}

if (routeCatalogTool === undefined) {
  failures.push(`Missing ${RawEngineAppServerHostToolName.RouteCatalog} tool.`);
} else {
  if (routeCatalogTool.mutates) failures.push('Route catalog tool must be read-only.');
  if (routeCatalogTool.toolKind !== RawEngineAppServerToolKind.Read) {
    failures.push('Route catalog tool must use read kind.');
  }
}
if (dispatchTool === undefined) {
  failures.push(`Missing ${RawEngineAppServerHostToolName.DispatchTool} tool.`);
} else {
  if (!dispatchTool.mutates) failures.push('Dispatch tool must be marked mutating-capable.');
  if (dispatchTool.toolKind !== RawEngineAppServerToolKind.Command) {
    failures.push('Dispatch tool must use command kind.');
  }
}

const replay = rawEngineAppServerHealthReplaySchema.parse(
  buildRawEngineAppServerHealthReplay({
    requestId: 'health_replay_001',
    toolName: RawEngineAppServerHostToolName.Health,
  }),
);

if (replay.response.status !== RawEngineAppServerResponseStatus.Ok) failures.push('Health replay did not return ok.');
if (replay.response.manifestToolCount !== manifest.tools.length) {
  failures.push('Health replay manifest count mismatch.');
}
if (replay.auditLog.length !== 1 || replay.auditLog[0]?.mutates) {
  failures.push('Health replay audit log must be read-only.');
}
if (replay.auditLog[0]?.toolName !== RawEngineAppServerHostToolName.Health) {
  failures.push('Health replay audit tool mismatch.');
}

const capabilitiesReplay = rawEngineAppServerCapabilitiesReplaySchema.parse(
  buildRawEngineAppServerCapabilitiesReplay({
    requestId: 'capabilities_replay_001',
    toolName: RawEngineAppServerHostToolName.Capabilities,
  }),
);

if (capabilitiesReplay.response.tools.length !== manifest.tools.length) {
  failures.push('Capabilities replay tool count mismatch.');
}
if (capabilitiesReplay.auditLog.length !== 1 || capabilitiesReplay.auditLog[0]?.mutates) {
  failures.push('Capabilities replay audit log must be read-only.');
}
if (capabilitiesReplay.auditLog[0]?.toolName !== RawEngineAppServerHostToolName.Capabilities) {
  failures.push('Capabilities replay audit tool mismatch.');
}

const routeCatalogReplay = rawEngineAppServerRouteCatalogReplaySchema.parse(
  buildRawEngineAppServerRouteCatalogReplay({
    requestId: 'route_catalog_replay_001',
    toolName: RawEngineAppServerHostToolName.RouteCatalog,
  }),
);

if (routeCatalogReplay.response.routes.length < 20) {
  failures.push('Route catalog replay must expose mapped editing routes.');
}
for (const expectedFamily of ['ai', 'computational_merge', 'film_look', 'negative_lab', 'tone_color']) {
  if (!routeCatalogReplay.response.routes.some((route) => route.family === expectedFamily)) {
    failures.push(`Route catalog missing ${expectedFamily}.`);
  }
}
for (const route of routeCatalogReplay.response.routes.filter((candidate) => candidate.family === 'ai')) {
  if (!route.runtimeCheckScripts.includes('check:ai-app-server-routes')) {
    failures.push(`${route.commandName}: AI route catalog entry must expose check:ai-app-server-routes.`);
  }
  if (route.toolNames.some((toolName) => toolName.startsWith('ai.mask.'))) {
    for (const expectedCheck of ['check:ai-mask-capabilities', 'check:ai-people-masks']) {
      if (!route.runtimeCheckScripts.includes(expectedCheck)) {
        failures.push(`${route.commandName}: AI mask route catalog entry missing ${expectedCheck}.`);
      }
    }
  }
  if (
    (route.commandName === 'ai.enhancement.dry_run_command' || route.commandName === 'ai.enhancement.apply_command') &&
    route.runtimeCheckScripts.includes('check:ai-denoise-runtime-apply')
  ) {
    if (!route.runtimeCheckScripts.includes('check:ai-denoise-app-server-tool')) {
      failures.push(`${route.commandName}: AI enhancement route catalog entry missing denoise tool proof check.`);
    }
  }
}
for (const route of routeCatalogReplay.response.routes.filter((candidate) => candidate.family === 'film_look')) {
  if (!route.runtimeCheckScripts.includes('check:film-look-app-server-routes')) {
    failures.push(`${route.commandName}: film route catalog entry must expose check:film-look-app-server-routes.`);
  }
}
for (const route of routeCatalogReplay.response.routes.filter((candidate) => candidate.family === 'negative_lab')) {
  if (!route.runtimeCheckScripts.includes('check:negative-lab-app-server-routes')) {
    failures.push(
      `${route.commandName}: Negative Lab route catalog entry must expose check:negative-lab-app-server-routes.`,
    );
  }
}
if (routeCatalogReplay.auditLog.length !== 1 || routeCatalogReplay.auditLog[0]?.mutates) {
  failures.push('Route catalog replay audit log must be read-only.');
}
if (routeCatalogReplay.auditLog[0]?.toolName !== RawEngineAppServerHostToolName.RouteCatalog) {
  failures.push('Route catalog replay audit tool mismatch.');
}

const dispatchedHealth = handleRawEngineAppServerHostRequest({
  requestId: 'dispatch_health_001',
  toolName: RawEngineAppServerHostToolName.Health,
});
if (dispatchedHealth.status !== RawEngineAppServerResponseStatus.Ok) failures.push('Dispatched health request failed.');

const dispatchedCapabilities = handleRawEngineAppServerHostRequest({
  requestId: 'dispatch_capabilities_001',
  toolName: RawEngineAppServerHostToolName.Capabilities,
});
if (dispatchedCapabilities.status !== RawEngineAppServerResponseStatus.Ok) {
  failures.push('Dispatched capabilities request failed.');
}

const dispatchedRouteCatalog = handleRawEngineAppServerHostRequest({
  requestId: 'dispatch_route_catalog_001',
  toolName: RawEngineAppServerHostToolName.RouteCatalog,
});
if (dispatchedRouteCatalog.status !== RawEngineAppServerResponseStatus.Ok) {
  failures.push('Dispatched route catalog request failed.');
}

const dispatchedToolCall = await handleRawEngineAppServerHostRequestAsync(dispatchRequest);
if (
  dispatchedToolCall.status !== RawEngineAppServerResponseStatus.Ok ||
  !('dispatchStatus' in dispatchedToolCall) ||
  dispatchedToolCall.dispatchStatus !== 'completed'
) {
  failures.push('Dispatched typed local tool call failed.');
}
const rejectedMismatchedToolCall = await handleRawEngineAppServerHostRequestAsync({
  ...dispatchRequest,
  runtimeToolName: 'tonecolor.apply_command',
});
if (
  !('dispatchStatus' in rejectedMismatchedToolCall) ||
  rejectedMismatchedToolCall.dispatchStatus !== 'rejected' ||
  rejectedMismatchedToolCall.message?.includes('validation rejected') !== true ||
  rejectedMismatchedToolCall.schemaIssues?.some((issue) => issue.path.join('.') === 'toolCall.approval.state') !== true
) {
  failures.push('Mismatched host tool dispatch must fail closed.');
}

const envelopeRequests = [
  {
    requestId: 'envelope_health_001',
    toolName: RawEngineAppServerHostToolName.Health,
  },
  {
    requestId: 'envelope_capabilities_001',
    toolName: RawEngineAppServerHostToolName.Capabilities,
  },
  {
    requestId: 'envelope_route_catalog_001',
    toolName: RawEngineAppServerHostToolName.RouteCatalog,
  },
];

for (const request of envelopeRequests) {
  const envelope = rawEngineAppServerHostResponseEnvelopeSchema.parse(
    buildRawEngineAppServerHostResponseEnvelope(request, '2026-06-17T12:00:00.000Z'),
  );

  if (envelope.status !== RawEngineAppServerResponseStatus.Ok) {
    failures.push(`${request.toolName} envelope did not return ok.`);
  }
  if (envelope.request.requestId !== request.requestId) failures.push(`${request.toolName} envelope request mismatch.`);
  if (envelope.response.requestId !== request.requestId) {
    failures.push(`${request.toolName} envelope response mismatch.`);
  }
  if (envelope.transport !== manifest.transport) failures.push(`${request.toolName} envelope transport mismatch.`);
}

const dispatchEnvelope = rawEngineAppServerHostResponseEnvelopeSchema.parse(
  await buildRawEngineAppServerHostResponseEnvelopeAsync(dispatchRequest, '2026-06-17T12:00:00.000Z'),
);
if (
  !('dispatchStatus' in dispatchEnvelope.response) ||
  dispatchEnvelope.response.dispatchStatus !== 'completed' ||
  dispatchEnvelope.response.runtimeToolName !== 'tonecolor.dry_run_command'
) {
  failures.push('Async dispatch envelope did not return completed typed tool result.');
}

const source = [
  'src/utils/rawEngineAppServerHost.ts',
  'src/schemas/agent/agentRuntimeSchemas.ts',
  'docs/agent/app-server-host-skeleton-2026-06-17.md',
]
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

for (const marker of [
  'RAW_ENGINE_APP_SERVER_HOST_MANIFEST',
  RawEngineAppServerHostToolName.Health,
  RawEngineAppServerHostToolName.Capabilities,
  RawEngineAppServerHostToolName.RouteCatalog,
  RawEngineAppServerHostToolName.DispatchTool,
  'buildRawEngineAppServerHostResponseEnvelope',
  'buildRawEngineAppServerHostResponseEnvelopeAsync',
  'buildRawEngineAppServerLifecycleReplay',
  'assertRawEngineAppServerLifecycleReady',
  'createRawEngineAppServerSupervisorState',
  'cancelRawEngineAppServerSupervisor',
  'rawEngineAppServerSupervisorStateSchema',
  'rawengine-app-server-stdio-fixture',
  'No UI automation',
  'codex app-server',
  'stdio JSONL',
]) {
  if (!source.includes(marker)) failures.push(`Missing marker ${marker}.`);
}

if (failures.length > 0) {
  console.error(`rawengine app-server host skeleton failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`rawengine app-server host skeleton ok (${manifest.tools.length} tools, lifecycle replay)`);
