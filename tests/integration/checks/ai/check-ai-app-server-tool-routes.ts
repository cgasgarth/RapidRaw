#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import {
  sampleAiAppServerToolManifestV1,
  sampleToolRegistryV1,
} from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  AiAppServerToolCapability,
  AiAppServerToolName,
  AiAppServerToolRouteExecutionMode,
  AiAppServerToolRouteSourceKind,
  AiAppServerToolRouteStatus,
} from '../../../../src/utils/ai/aiAppServerToolRouteIds.ts';
import { AI_APP_SERVER_TOOL_ROUTES } from '../../../../src/utils/ai/aiAppServerToolRoutes.ts';
import { AI_MASK_CAPABILITY_AUDIT } from '../../../../src/utils/ai/aiMaskCapabilities.ts';

const COMMANDS_PATH = 'src/tauri/commands.ts';
const commandsSource = readFileSync(COMMANDS_PATH, 'utf8');
const invokesEnum = /export enum Invokes \{(?<body>[\s\S]*?)\n\}/u.exec(commandsSource)?.groups?.body;
if (invokesEnum === undefined) {
  throw new Error('Unable to locate Invokes enum.');
}

const routeInvokes = new Set(
  AI_APP_SERVER_TOOL_ROUTES.filter((route) => route.sourceKind === AiAppServerToolRouteSourceKind.TauriInvoke).map(
    (route) => route.sourceOperation,
  ),
);
const mappedToolNames = new Set(
  AI_APP_SERVER_TOOL_ROUTES.filter(
    (route) => route.status === AiAppServerToolRouteStatus.Mapped && route.appServerToolName !== undefined,
  ).map((route) => route.appServerToolName),
);
const registeredToolByName = new Map(sampleToolRegistryV1.tools.map((tool) => [tool.toolName, tool]));
const aiToolByName = new Map(sampleAiAppServerToolManifestV1.tools.map((tool) => [tool.toolName, tool]));
const aiToolCapabilities = new Map(
  sampleAiAppServerToolManifestV1.tools.map((tool) => [tool.toolName, new Set(tool.allowedCapabilities)]),
);
const failures = [];
const runtimeCheckCommands = [
  ['bun', 'tests/integration/checks/ai/check-ai-mask-capabilities.ts'],
  ['bun', 'tests/integration/checks/ai/check-ai-mask-app-server-tool.ts'],
  ['bun', 'tests/integration/checks/ai/check-ai-people-mask-contract.ts'],
  ['bun', 'tests/integration/checks/ai/check-ai-people-layer-apply-plan.ts'],
  ['bun', 'tests/integration/checks/ai/check-ai-denoise-app-server-tool.ts'],
  ['bun', 'tests/integration/checks/ai/check-ai-denoise-runtime-apply.ts'],
] satisfies Array<[string, ...string[]]>;

const toolCapabilityByAiMaskCapability = new Map([
  ['depth', AiAppServerToolCapability.DepthMask],
  ['foreground', AiAppServerToolCapability.ForegroundMask],
  ['person', AiAppServerToolCapability.PersonMask],
  ['sky', AiAppServerToolCapability.SkyMask],
  ['subject', AiAppServerToolCapability.SubjectMask],
]);

const aiInvokePattern = /^\s*(?<key>[A-Za-z0-9_]*(?:AI|Ai|Generative)[A-Za-z0-9_]*)\s*=\s*'(?<invoke>[^']+)'/gmu;
for (const match of invokesEnum.matchAll(aiInvokePattern)) {
  const invoke = match.groups?.invoke;
  if (invoke === undefined) continue;

  if (!routeInvokes.has(invoke)) {
    failures.push(`${invoke} is missing from AI app-server route manifest.`);
  }
}

if (!routeInvokes.has('precompute_ai_subject_mask')) {
  failures.push('precompute_ai_subject_mask string invoke is missing from AI app-server route manifest.');
}

for (const invoke of ['apply_denoising', 'save_denoised_image']) {
  const route = AI_APP_SERVER_TOOL_ROUTES.find((candidate) => candidate.sourceOperation === invoke);
  if (route === undefined) {
    failures.push(`${invoke} is missing from AI app-server route manifest.`);
    continue;
  }

  if (route.toolCapability !== AiAppServerToolCapability.Denoise) {
    failures.push(`${invoke} must declare denoise capability.`);
  }

  if (route.status === AiAppServerToolRouteStatus.Mapped) {
    failures.push(`${invoke} must not be mapped until AI denoise dry-run/apply provenance is implemented.`);
  }

  if (route.status === AiAppServerToolRouteStatus.Deferred && route.deferredIssue !== '#1963') {
    failures.push(`${invoke} deferred route must track #1963.`);
  }
}

for (const [toolName, executionMode] of [
  [AiAppServerToolName.EnhancementDryRunCommand, AiAppServerToolRouteExecutionMode.DryRunCommand],
  [AiAppServerToolName.EnhancementApplyCommand, AiAppServerToolRouteExecutionMode.ApplyDryRunPlan],
] as const) {
  const route = AI_APP_SERVER_TOOL_ROUTES.find(
    (candidate) =>
      candidate.sourceKind === AiAppServerToolRouteSourceKind.AppServerTool &&
      candidate.sourceOperation === toolName &&
      candidate.toolCapability === AiAppServerToolCapability.Denoise,
  );
  if (route === undefined) {
    failures.push(`${toolName} is missing a local AI denoise app-server route.`);
    continue;
  }

  if (route.executionMode !== executionMode) {
    failures.push(`${toolName} denoise route must use ${executionMode}.`);
  }

  if (route.status !== AiAppServerToolRouteStatus.Mapped) {
    failures.push(`${toolName} denoise route must be mapped.`);
  }
}

for (const route of AI_APP_SERVER_TOOL_ROUTES) {
  const registeredTool =
    route.status === AiAppServerToolRouteStatus.Mapped && route.appServerToolName !== undefined
      ? registeredToolByName.get(route.appServerToolName)
      : undefined;

  if (
    route.status === AiAppServerToolRouteStatus.Mapped &&
    route.appServerToolName !== undefined &&
    registeredTool === undefined
  ) {
    failures.push(`${route.sourceOperation} maps to unregistered tool ${route.appServerToolName}.`);
  }

  if (
    route.status === AiAppServerToolRouteStatus.Mapped &&
    route.commandSchemaName !== undefined &&
    registeredTool !== undefined &&
    route.commandSchemaName !== registeredTool.inputSchemaName
  ) {
    failures.push(
      `${route.sourceOperation} declares ${route.commandSchemaName} but ${route.appServerToolName} expects ${registeredTool.inputSchemaName}.`,
    );
  }

  if (
    route.status === AiAppServerToolRouteStatus.Mapped &&
    route.outputSchemaName !== undefined &&
    registeredTool !== undefined &&
    route.outputSchemaName !== registeredTool.outputSchemaName
  ) {
    failures.push(
      `${route.sourceOperation} declares ${route.outputSchemaName} but ${route.appServerToolName} returns ${registeredTool.outputSchemaName}.`,
    );
  }

  if (
    route.status === AiAppServerToolRouteStatus.Mapped &&
    route.appServerToolName !== undefined &&
    route.executionMode !== undefined
  ) {
    const aiTool = aiToolByName.get(route.appServerToolName);
    if (aiTool !== undefined && route.executionMode !== aiTool.executionMode) {
      failures.push(
        `${route.sourceOperation} declares ${route.executionMode} but ${route.appServerToolName} uses ${aiTool.executionMode}.`,
      );
    }
  }

  if (
    route.status === AiAppServerToolRouteStatus.Mapped &&
    route.appServerToolName !== undefined &&
    route.toolCapability !== undefined
  ) {
    const capabilities = aiToolCapabilities.get(route.appServerToolName);
    if (capabilities === undefined) {
      failures.push(`${route.sourceOperation} maps to AI tool ${route.appServerToolName} with no AI manifest entry.`);
    } else if (!capabilities.has(route.toolCapability)) {
      failures.push(
        `${route.sourceOperation} maps to ${route.appServerToolName} without ${route.toolCapability} support.`,
      );
    }
  }
}

for (const toolName of aiToolCapabilities.keys()) {
  if (!mappedToolNames.has(toolName)) {
    failures.push(`${toolName} is missing from AI app-server route manifest.`);
  }
}

for (const capability of AI_MASK_CAPABILITY_AUDIT) {
  if (capability.status !== 'native' || capability.invokeCommand === null) continue;

  const route = AI_APP_SERVER_TOOL_ROUTES.find((candidate) => candidate.sourceOperation === capability.invokeCommand);
  if (route === undefined) {
    failures.push(`${capability.invokeCommand}: native AI mask capability has no app-server route.`);
    continue;
  }

  const expectedToolCapability = toolCapabilityByAiMaskCapability.get(capability.capability);
  if (expectedToolCapability !== route.toolCapability) {
    failures.push(`${capability.invokeCommand}: expected route capability ${expectedToolCapability}.`);
  }

  if (route.status === AiAppServerToolRouteStatus.Deferred) {
    const supportedByMappedTool = [...aiToolCapabilities.values()].some((capabilities) =>
      capabilities.has(route.toolCapability),
    );
    if (supportedByMappedTool) {
      failures.push(`${capability.invokeCommand}: supported AI mask capability should be mapped, not deferred.`);
    }
  }
}

for (const runtimeCheckCommand of runtimeCheckCommands) {
  runCommand(runtimeCheckCommand);
}

if (failures.length > 0) {
  console.error('AI app-server route validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('ai app-server routes ok');

function runCommand(command: [string, ...string[]]): void {
  const result = Bun.spawnSync(command, {
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (result.exitCode === 0) return;

  const output = [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .slice(-20)
    .join('\n');
  failures.push(`${command.join(' ')} failed:\n${output}`);
}
