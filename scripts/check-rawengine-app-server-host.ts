#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { z } from 'zod';

import {
  RAW_ENGINE_APP_SERVER_HOST_MANIFEST,
  buildRawEngineAppServerCapabilitiesReplay,
  buildRawEngineAppServerHealthReplay,
  buildRawEngineAppServerHostResponseEnvelope,
  buildRawEngineAppServerLifecycleReplay,
  buildRawEngineAppServerRouteCatalogReplay,
  cancelRawEngineAppServerSupervisor,
  createRawEngineAppServerLifecycleState,
  createRawEngineAppServerSupervisorState,
  failRawEngineAppServerSupervisor,
  handleRawEngineAppServerHostRequest,
  initializeRawEngineAppServerLifecycle,
  assertRawEngineAppServerLifecycleReady,
  markRawEngineAppServerSupervisorReady,
  startRawEngineAppServerSupervisor,
  stopRawEngineAppServerLifecycle,
  stopRawEngineAppServerSupervisor,
} from '../src/utils/rawEngineAppServerHost.ts';
import {
  rawEngineAppServerCapabilitiesReplaySchema,
  rawEngineAppServerHealthReplaySchema,
  rawEngineAppServerHostResponseEnvelopeSchema,
  rawEngineAppServerHostManifestSchema,
  rawEngineAppServerLifecycleReplaySchema,
  rawEngineAppServerRouteCatalogReplaySchema,
  rawEngineAppServerSupervisorStateSchema,
} from '../src/schemas/agentRuntimeSchemas.ts';

const failures = [];
const manifest = rawEngineAppServerHostManifestSchema.parse(RAW_ENGINE_APP_SERVER_HOST_MANIFEST);
const healthTool = manifest.tools.find((tool) => tool.toolName === 'rawengine.host.health');
const capabilitiesTool = manifest.tools.find((tool) => tool.toolName === 'rawengine.host.capabilities');
const routeCatalogTool = manifest.tools.find((tool) => tool.toolName === 'rawengine.host.route_catalog');
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
        protocol: z.literal('codex_app_server'),
        ready: z.literal(true),
        transport: z.literal('stdio_jsonl'),
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

if (lifecycleReplay.finalState.phase !== 'stopped') failures.push('Lifecycle replay must finish stopped.');
if (lifecycleReplay.events.map((event) => event.phase).join(',') !== 'created,initialized,stopped') {
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

if (supervisorStopped.phase !== 'stopped') failures.push('Supervisor stop should finish stopped.');
if (supervisorStopped.processId !== null) failures.push('Supervisor stop must clear processId.');
if (supervisorStopped.cancellationRequestedAtIso === null) {
  failures.push('Supervisor cancellation should remain audit-visible after stop.');
}
if (supervisorStopped.auditEvents.map((event) => event.kind).join(',') !== 'created,start,ready,cancel,stop') {
  failures.push('Supervisor audit event order mismatch.');
}

const supervisorFailed = failRawEngineAppServerSupervisor({
  error: {
    code: 'health_timeout',
    message: 'App-server health check did not report initialized before timeout.',
    recoverable: true,
  },
  state: supervisorStarting,
  timestampIso: '2026-06-17T12:00:05.000Z',
});
if (supervisorFailed.error?.code !== 'health_timeout')
  failures.push('Supervisor failure should keep structured error.');
if (!supervisorFailed.auditEvents.some((event) => event.kind === 'fail')) {
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

  if (initializeResponseLine === undefined || threadStartedLine === undefined) {
    return failRawEngineAppServerSupervisor({
      error: {
        code: 'health_timeout',
        message: 'stdio fixture did not emit initialize response and thread notification.',
        recoverable: true,
      },
      state,
      timestampIso: '2026-06-17T12:03:02.000Z',
    });
  }

  fixtureResponseSchema.parse(JSON.parse(initializeResponseLine));
  fixtureThreadNotificationSchema.parse(JSON.parse(threadStartedLine));
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
if (launchProof.phase !== 'stopped') failures.push('Executable stdio launch proof must finish stopped.');
if (launchProof.error !== null) failures.push(`Executable stdio launch proof failed: ${launchProof.error.message}`);
if (launchProof.auditEvents.map((event) => event.kind).join(',') !== 'created,start,ready,stop') {
  failures.push('Executable stdio launch proof audit event order mismatch.');
}

if (healthTool === undefined) {
  failures.push('Missing rawengine.host.health tool.');
} else {
  if (healthTool.mutates) failures.push('Health tool must be read-only.');
  if (healthTool.toolKind !== 'read') failures.push('Health tool must use read kind.');
}

if (capabilitiesTool === undefined) {
  failures.push('Missing rawengine.host.capabilities tool.');
} else {
  if (capabilitiesTool.mutates) failures.push('Capabilities tool must be read-only.');
  if (capabilitiesTool.toolKind !== 'read') failures.push('Capabilities tool must use read kind.');
}

if (routeCatalogTool === undefined) {
  failures.push('Missing rawengine.host.route_catalog tool.');
} else {
  if (routeCatalogTool.mutates) failures.push('Route catalog tool must be read-only.');
  if (routeCatalogTool.toolKind !== 'read') failures.push('Route catalog tool must use read kind.');
}

const replay = rawEngineAppServerHealthReplaySchema.parse(
  buildRawEngineAppServerHealthReplay({
    requestId: 'health_replay_001',
    toolName: 'rawengine.host.health',
  }),
);

if (replay.response.status !== 'ok') failures.push('Health replay did not return ok.');
if (replay.response.manifestToolCount !== manifest.tools.length) {
  failures.push('Health replay manifest count mismatch.');
}
if (replay.auditLog.length !== 1 || replay.auditLog[0]?.mutates) {
  failures.push('Health replay audit log must be read-only.');
}
if (replay.auditLog[0]?.toolName !== 'rawengine.host.health') {
  failures.push('Health replay audit tool mismatch.');
}

const capabilitiesReplay = rawEngineAppServerCapabilitiesReplaySchema.parse(
  buildRawEngineAppServerCapabilitiesReplay({
    requestId: 'capabilities_replay_001',
    toolName: 'rawengine.host.capabilities',
  }),
);

if (capabilitiesReplay.response.tools.length !== manifest.tools.length) {
  failures.push('Capabilities replay tool count mismatch.');
}
if (capabilitiesReplay.auditLog.length !== 1 || capabilitiesReplay.auditLog[0]?.mutates) {
  failures.push('Capabilities replay audit log must be read-only.');
}
if (capabilitiesReplay.auditLog[0]?.toolName !== 'rawengine.host.capabilities') {
  failures.push('Capabilities replay audit tool mismatch.');
}

const routeCatalogReplay = rawEngineAppServerRouteCatalogReplaySchema.parse(
  buildRawEngineAppServerRouteCatalogReplay({
    requestId: 'route_catalog_replay_001',
    toolName: 'rawengine.host.route_catalog',
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
if (routeCatalogReplay.auditLog.length !== 1 || routeCatalogReplay.auditLog[0]?.mutates) {
  failures.push('Route catalog replay audit log must be read-only.');
}
if (routeCatalogReplay.auditLog[0]?.toolName !== 'rawengine.host.route_catalog') {
  failures.push('Route catalog replay audit tool mismatch.');
}

const dispatchedHealth = handleRawEngineAppServerHostRequest({
  requestId: 'dispatch_health_001',
  toolName: 'rawengine.host.health',
});
if (dispatchedHealth.status !== 'ok') failures.push('Dispatched health request failed.');

const dispatchedCapabilities = handleRawEngineAppServerHostRequest({
  requestId: 'dispatch_capabilities_001',
  toolName: 'rawengine.host.capabilities',
});
if (dispatchedCapabilities.status !== 'ok') failures.push('Dispatched capabilities request failed.');

const dispatchedRouteCatalog = handleRawEngineAppServerHostRequest({
  requestId: 'dispatch_route_catalog_001',
  toolName: 'rawengine.host.route_catalog',
});
if (dispatchedRouteCatalog.status !== 'ok') failures.push('Dispatched route catalog request failed.');

const envelopeRequests = [
  {
    requestId: 'envelope_health_001',
    toolName: 'rawengine.host.health',
  },
  {
    requestId: 'envelope_capabilities_001',
    toolName: 'rawengine.host.capabilities',
  },
  {
    requestId: 'envelope_route_catalog_001',
    toolName: 'rawengine.host.route_catalog',
  },
];

for (const request of envelopeRequests) {
  const envelope = rawEngineAppServerHostResponseEnvelopeSchema.parse(
    buildRawEngineAppServerHostResponseEnvelope(request, '2026-06-17T12:00:00.000Z'),
  );

  if (envelope.status !== 'ok') failures.push(`${request.toolName} envelope did not return ok.`);
  if (envelope.request.requestId !== request.requestId) failures.push(`${request.toolName} envelope request mismatch.`);
  if (envelope.response.requestId !== request.requestId) {
    failures.push(`${request.toolName} envelope response mismatch.`);
  }
  if (envelope.transport !== manifest.transport) failures.push(`${request.toolName} envelope transport mismatch.`);
}

const source = [
  'src/utils/rawEngineAppServerHost.ts',
  'src/schemas/agentRuntimeSchemas.ts',
  'docs/agent/app-server-host-skeleton-2026-06-17.md',
]
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

for (const marker of [
  'RAW_ENGINE_APP_SERVER_HOST_MANIFEST',
  'rawengine.host.health',
  'rawengine.host.capabilities',
  'rawengine.host.route_catalog',
  'buildRawEngineAppServerHostResponseEnvelope',
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
