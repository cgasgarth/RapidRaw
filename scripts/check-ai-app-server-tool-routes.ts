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

const routeInvokes = new Set(AI_APP_SERVER_TOOL_ROUTES.map((route) => route.tauriInvoke));
const registeredTools = new Set(sampleToolRegistryV1.tools.map((tool) => tool.toolName));
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

for (const route of AI_APP_SERVER_TOOL_ROUTES) {
  if (
    route.status === 'mapped' &&
    route.appServerToolName !== undefined &&
    !registeredTools.has(route.appServerToolName)
  ) {
    failures.push(`${route.tauriInvoke} maps to unregistered tool ${route.appServerToolName}.`);
  }

  if (route.status === 'mapped' && route.appServerToolName !== undefined && route.toolCapability !== undefined) {
    const capabilities = aiToolCapabilities.get(route.appServerToolName);
    if (capabilities === undefined) {
      failures.push(`${route.tauriInvoke} maps to AI tool ${route.appServerToolName} with no AI manifest entry.`);
    } else if (!capabilities.has(route.toolCapability)) {
      failures.push(`${route.tauriInvoke} maps to ${route.appServerToolName} without ${route.toolCapability} support.`);
    }
  }
}

for (const capability of AI_MASK_CAPABILITY_AUDIT) {
  if (capability.status !== 'native' || capability.invokeCommand === null) continue;

  const route = AI_APP_SERVER_TOOL_ROUTES.find((candidate) => candidate.tauriInvoke === capability.invokeCommand);
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
