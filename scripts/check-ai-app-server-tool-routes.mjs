#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { AI_APP_SERVER_TOOL_ROUTES } from '../src/utils/aiAppServerToolRoutes.ts';
import { sampleToolRegistryV1 } from '../packages/rawengine-schema/src/samplePayloads.ts';

const APP_PROPERTIES_PATH = 'src/components/ui/AppProperties.tsx';
const appProperties = readFileSync(APP_PROPERTIES_PATH, 'utf8');
const invokesEnum = /export enum Invokes \{(?<body>[\s\S]*?)\n\}/u.exec(appProperties)?.groups?.body;
if (invokesEnum === undefined) {
  throw new Error('Unable to locate Invokes enum.');
}

const routeInvokes = new Set(AI_APP_SERVER_TOOL_ROUTES.map((route) => route.tauriInvoke));
const registeredTools = new Set(sampleToolRegistryV1.tools.map((tool) => tool.toolName));
const failures = [];

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
}

if (failures.length > 0) {
  console.error('AI app-server route validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('ai app-server routes ok');
