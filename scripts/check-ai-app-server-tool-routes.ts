#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { AI_APP_SERVER_TOOL_ROUTES } from '../src/utils/aiAppServerToolRoutes.ts';
import { AI_MASK_CAPABILITY_AUDIT } from '../src/utils/aiMaskCapabilities.ts';
import {
  sampleAiAppServerToolManifestV1,
  sampleToolRegistryV1,
} from '../packages/rawengine-schema/src/samplePayloads.ts';

const APP_PROPERTIES_PATH = 'src/components/ui/AppProperties.tsx';
const appProperties = readFileSync(APP_PROPERTIES_PATH, 'utf8');
const invokesEnum = /export enum Invokes \{(?<body>[\s\S]*?)\n\}/u.exec(appProperties)?.groups?.body;
if (invokesEnum === undefined) {
  throw new Error('Unable to locate Invokes enum.');
}

const routeInvokes = new Set(
  AI_APP_SERVER_TOOL_ROUTES.filter((route) => route.sourceKind === 'tauri_invoke').map(
    (route) => route.sourceOperation,
  ),
);
const mappedToolNames = new Set(
  AI_APP_SERVER_TOOL_ROUTES.filter((route) => route.status === 'mapped' && route.appServerToolName !== undefined).map(
    (route) => route.appServerToolName,
  ),
);
const registeredToolByName = new Map(sampleToolRegistryV1.tools.map((tool) => [tool.toolName, tool]));
const aiToolByName = new Map(sampleAiAppServerToolManifestV1.tools.map((tool) => [tool.toolName, tool]));
const aiToolCapabilities = new Map(
  sampleAiAppServerToolManifestV1.tools.map((tool) => [tool.toolName, new Set(tool.allowedCapabilities)]),
);
const failures = [];

const toolCapabilityByAiMaskCapability = new Map([
  ['depth', 'depth_mask'],
  ['foreground', 'foreground_mask'],
  ['sky', 'sky_mask'],
  ['subject', 'subject_mask'],
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

  if (route.toolCapability !== 'denoise') {
    failures.push(`${invoke} must declare denoise capability.`);
  }

  if (route.status === 'mapped') {
    failures.push(`${invoke} must not be mapped until AI denoise dry-run/apply provenance is implemented.`);
  }

  if (route.status === 'deferred' && route.deferredIssue !== '#1276') {
    failures.push(`${invoke} deferred route must track #1276.`);
  }
}

for (const route of AI_APP_SERVER_TOOL_ROUTES) {
  const registeredTool =
    route.status === 'mapped' && route.appServerToolName !== undefined
      ? registeredToolByName.get(route.appServerToolName)
      : undefined;

  if (route.status === 'mapped' && route.appServerToolName !== undefined && registeredTool === undefined) {
    failures.push(`${route.sourceOperation} maps to unregistered tool ${route.appServerToolName}.`);
  }

  if (
    route.status === 'mapped' &&
    route.commandSchemaName !== undefined &&
    registeredTool !== undefined &&
    route.commandSchemaName !== registeredTool.inputSchemaName
  ) {
    failures.push(
      `${route.sourceOperation} declares ${route.commandSchemaName} but ${route.appServerToolName} expects ${registeredTool.inputSchemaName}.`,
    );
  }

  if (
    route.status === 'mapped' &&
    route.outputSchemaName !== undefined &&
    registeredTool !== undefined &&
    route.outputSchemaName !== registeredTool.outputSchemaName
  ) {
    failures.push(
      `${route.sourceOperation} declares ${route.outputSchemaName} but ${route.appServerToolName} returns ${registeredTool.outputSchemaName}.`,
    );
  }

  if (route.status === 'mapped' && route.appServerToolName !== undefined && route.executionMode !== undefined) {
    const aiTool = aiToolByName.get(route.appServerToolName);
    if (aiTool !== undefined && route.executionMode !== aiTool.executionMode) {
      failures.push(
        `${route.sourceOperation} declares ${route.executionMode} but ${route.appServerToolName} uses ${aiTool.executionMode}.`,
      );
    }
  }

  if (route.status === 'mapped' && route.appServerToolName !== undefined && route.toolCapability !== undefined) {
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

  if (route.status === 'deferred') {
    const supportedByMappedTool = [...aiToolCapabilities.values()].some((capabilities) =>
      capabilities.has(route.toolCapability),
    );
    if (supportedByMappedTool) {
      failures.push(`${capability.invokeCommand}: supported AI mask capability should be mapped, not deferred.`);
    }
  }
}

if (failures.length > 0) {
  console.error('AI app-server route validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('ai app-server routes ok');
