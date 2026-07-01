#!/usr/bin/env bun

import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import {
  RawEngineAppServerHostToolName,
  RawEngineAppServerResponseStatus,
  type RawEngineAppServerRouteMode,
  RawEngineAppServerTransport,
  rawEngineAppServerCapabilitiesResponseSchema,
  rawEngineAppServerHealthResponseSchema,
  rawEngineAppServerHostResponseEnvelopeSchema,
  rawEngineAppServerRouteCatalogResponseSchema,
  rawEngineAppServerToolDispatchResponseSchema,
} from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST_DATA } from '../../../../src/utils/computational-merge/computationalMergeAppServerRouteManifestData.ts';
import {
  NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME,
  negativeLabAgentInspectResponseSchema,
} from '../../../../src/utils/negative-lab/app-server/negativeLabAgentReadOnlyAppServerTools.ts';

const DEFAULT_APP_PATH = '/Applications/RapidRAW.app';
const BUNDLE_ID = 'io.github.CyberTimon.RapidRAW';
const PROCESS_NAME = 'RapidRAW';
const REPORT_PATH = 'docs/validation/app-server/local-app-server-install-e2e-report.json';
const args = process.argv.slice(2);

const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const appPath = resolve(valueAfter('--app-path') ?? DEFAULT_APP_PATH);
const reportPath = valueAfter('--report') ?? REPORT_PATH;
const shouldKeepLaunchedApp = args.includes('--keep-running');

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

const run = async (command: string, commandArgs: string[], stdin?: string): Promise<CommandResult> => {
  const proc = Bun.spawn([command, ...commandArgs], {
    stderr: 'pipe',
    stdin: stdin === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
  });
  if (stdin !== undefined) {
    proc.stdin.write(stdin);
    proc.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
};

const requireOk = async (
  command: string,
  commandArgs: string[],
  label: string,
  stdin?: string,
): Promise<CommandResult> => {
  const result = await run(command, commandArgs, stdin);
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().split('\n').slice(-8).join('\n');
    throw new Error(`${label} failed with exit ${result.exitCode}${detail.length > 0 ? `:\n${detail}` : ''}`);
  }
  return result;
};

const readPlistValue = async (key: string): Promise<string> => {
  const result = await requireOk(
    '/usr/libexec/PlistBuddy',
    ['-c', `Print :${key}`, join(appPath, 'Contents/Info.plist')],
    `read bundle ${key}`,
  );
  return result.stdout.trim();
};

const listRapidRawPids = async (): Promise<string[]> => {
  const result = await run('pgrep', ['-x', PROCESS_NAME]);
  if (result.exitCode === 1) return [];
  if (result.exitCode !== 0) throw new Error(`pgrep failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const waitForLaunch = async (previousPids: Set<string>): Promise<string[]> => {
  const deadline = Date.now() + 15_000;
  let lastPids: string[] = [];
  while (Date.now() < deadline) {
    lastPids = await listRapidRawPids();
    if (lastPids.length > 0 && (previousPids.size === 0 || lastPids.some((pid) => !previousPids.has(pid)))) {
      return lastPids;
    }
    await Bun.sleep(500);
  }
  throw new Error(`RapidRAW did not launch within 15s; last pids: ${lastPids.join(',') || 'none'}`);
};

const redactAppPath = (path: string): string =>
  path === DEFAULT_APP_PATH ? `/Applications/${basename(path)}` : `<local-app-path>/${basename(path)}`;

const jsonRpcReadySchema = z
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

const notificationSchema = z
  .object({
    method: z.literal('thread/started'),
    params: z.object({ thread: z.object({ id: z.string().trim().min(1) }).strict() }).strict(),
  })
  .strict();

const parseHostEnvelope = (line: string) => rawEngineAppServerHostResponseEnvelopeSchema.parse(JSON.parse(line));

const requestLines = [
  JSON.stringify({
    id: 1,
    method: 'initialize',
    params: { clientInfo: { name: 'local_bundle_qa', title: 'Local Bundle QA', version: '1.0.0' } },
  }),
  JSON.stringify({ method: 'initialized', params: {} }),
  JSON.stringify({ requestId: 'bundle_qa_health', toolName: RawEngineAppServerHostToolName.Health }),
  JSON.stringify({ requestId: 'bundle_qa_capabilities', toolName: RawEngineAppServerHostToolName.Capabilities }),
  JSON.stringify({ requestId: 'bundle_qa_route_catalog', toolName: RawEngineAppServerHostToolName.RouteCatalog }),
  JSON.stringify({
    arguments: {
      frameHealth: {
        activePathIndex: 0,
        baseFogConfidence: 0.87,
        includedPaths: ['/qa/negative-lab-001.CR3'],
        previewReady: true,
        targetPaths: ['/qa/negative-lab-001.CR3', '/qa/negative-lab-002.CR3'],
      },
      requestId: 'bundle_qa_negative_lab_inspect',
      selectedFrameIds: ['negative-lab-bundle-qa-frame-1'],
      selectedScope: 'all',
      sessionId: 'bundle_qa_negative_lab',
    },
    requestId: 'bundle_qa_negative_lab_inspect_dispatch',
    runtimeToolName: NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME,
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  }),
].join('\n');

const assertRoute = ({
  catalog,
  family,
  mode,
  runtimeCheckScript,
}: {
  catalog: z.infer<typeof rawEngineAppServerRouteCatalogResponseSchema>['routes'];
  family: string;
  mode?: RawEngineAppServerRouteMode;
  runtimeCheckScript?: string;
}) => {
  const route = catalog.find(
    (candidate) =>
      candidate.family === family &&
      (mode === undefined || candidate.modes.includes(mode)) &&
      (runtimeCheckScript === undefined || candidate.runtimeCheckScripts.includes(runtimeCheckScript)),
  );
  if (route === undefined) {
    throw new Error(
      `route catalog missing ${family}${mode === undefined ? '' : ` ${mode}`}${
        runtimeCheckScript === undefined ? '' : ` (${runtimeCheckScript})`
      }`,
    );
  }
};

let launchedPids: string[] = [];
let shouldCleanupLaunch = false;

const main = async () => {
  await access(join(appPath, 'Contents/MacOS', PROCESS_NAME));
  const [bundleIdentifier, bundleVersion] = await Promise.all([
    readPlistValue('CFBundleIdentifier'),
    readPlistValue('CFBundleShortVersionString'),
  ]);
  if (bundleIdentifier !== BUNDLE_ID) {
    throw new Error(`bundle id mismatch: expected ${BUNDLE_ID}, found ${bundleIdentifier}`);
  }

  const pidsBefore = new Set(await listRapidRawPids());
  await requireOk('open', ['-n', appPath], 'launch installed app');
  launchedPids = await waitForLaunch(pidsBefore);
  shouldCleanupLaunch = pidsBefore.size === 0 && !shouldKeepLaunchedApp;

  const stdio = await requireOk(
    'bun',
    ['scripts/fixtures/rawengine-app-server-stdio-fixture.ts'],
    'stdio host runtime',
    requestLines,
  );
  const lines = stdio.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length !== 6) throw new Error(`expected 6 stdio responses, received ${lines.length}`);

  jsonRpcReadySchema.parse(JSON.parse(lines[0]));
  notificationSchema.parse(JSON.parse(lines[1]));

  const health = rawEngineAppServerHealthResponseSchema.parse(parseHostEnvelope(lines[2]).response);
  const capabilities = rawEngineAppServerCapabilitiesResponseSchema.parse(parseHostEnvelope(lines[3]).response);
  const routeCatalog = rawEngineAppServerRouteCatalogResponseSchema.parse(parseHostEnvelope(lines[4]).response);
  const dispatch = rawEngineAppServerToolDispatchResponseSchema.parse(parseHostEnvelope(lines[5]).response);
  const negativeLabInspect = negativeLabAgentInspectResponseSchema.parse(dispatch.result);

  if (health.status !== RawEngineAppServerResponseStatus.Ok) throw new Error('health response was not ok');
  if (health.transport !== RawEngineAppServerTransport.StdioJsonl) throw new Error('health transport mismatch');
  if (capabilities.tools.length !== health.manifestToolCount)
    throw new Error('capabilities/health tool count mismatch');
  for (const toolName of [
    RawEngineAppServerHostToolName.Health,
    RawEngineAppServerHostToolName.Capabilities,
    RawEngineAppServerHostToolName.RouteCatalog,
    RawEngineAppServerHostToolName.DispatchTool,
  ]) {
    if (!capabilities.tools.some((tool) => tool.toolName === toolName)) {
      throw new Error(`capabilities missing ${toolName}`);
    }
  }
  if (dispatch.dispatchStatus !== 'completed') throw new Error(`read-only dispatch rejected: ${dispatch.message}`);
  if (
    negativeLabInspect.toolName !== NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME ||
    negativeLabInspect.proof.readOnly !== true ||
    negativeLabInspect.proof.stateMutationProhibited !== true
  ) {
    throw new Error('read-only Negative Lab inspect dispatch returned unexpected proof identity');
  }

  assertRoute({ catalog: routeCatalog.routes, family: 'agent', mode: 'read' });
  for (const runtimeCheckScript of [
    'check:hdr-app-server-runtime',
    'check:panorama-app-server-runtime',
    'check:focus-app-server-runtime',
    'check:sr-app-server-runtime',
  ]) {
    assertRoute({
      catalog: routeCatalog.routes,
      family: 'computational_merge',
      mode: 'dry_run_command',
      runtimeCheckScript,
    });
  }

  const computationalRouteCount = routeCatalog.routes.filter((route) => route.family === 'computational_merge').length;
  const computationalManifestFamilyCount = new Set(
    COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST_DATA.routes.map((route) => route.family),
  ).size;
  if (computationalRouteCount !== computationalManifestFamilyCount) {
    throw new Error(
      `computational merge route family count mismatch: catalog=${computationalRouteCount}, manifest families=${computationalManifestFamilyCount}`,
    );
  }

  const report = {
    app: {
      bundleIdentifier,
      bundleVersion,
      launchObserved: launchedPids.length > 0,
      launchedProcessName: PROCESS_NAME,
      path: redactAppPath(appPath),
    },
    checks: {
      capabilitiesToolCount: capabilities.tools.length,
      healthStatus: health.status,
      readOnlyDispatch: {
        requestId: negativeLabInspect.requestId,
        status: dispatch.dispatchStatus,
        toolName: dispatch.runtimeToolName,
      },
      routeCatalog: {
        agentRouteCount: routeCatalog.routes.filter((route) => route.family === 'agent').length,
        computationalMergeRouteCount: computationalRouteCount,
        computationalMergeUnderlyingManifestRouteCount:
          COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST_DATA.routes.length,
        routeCount: routeCatalog.routes.length,
        selectedRuntimeCheckScripts: [
          'check:hdr-app-server-runtime',
          'check:panorama-app-server-runtime',
          'check:focus-app-server-runtime',
          'check:sr-app-server-runtime',
        ],
      },
    },
    generatedAt: '2026-07-01T00:00:00.000Z',
    schemaVersion: 1,
    transport: health.transport,
  };

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `local app-server install e2e ok (${bundleIdentifier}; routes=${routeCatalog.routes.length}; report=${reportPath})`,
  );
};

try {
  await main();
} catch (error) {
  console.error('local app-server install e2e failed:');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (shouldCleanupLaunch) {
    await run('pkill', ['-x', PROCESS_NAME]);
  }
}
