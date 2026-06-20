#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { z } from 'zod';

const APP_PROPERTIES_PATH = 'src/components/ui/AppProperties.tsx';
const RUST_LIB_PATH = 'src-tauri/src/lib.rs';

const knownFrontendOnlyInvokes = {} as const;

const knownRegisteredStringInvokes = {} as const;

const commandNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/u);

const appProperties = readFileSync(APP_PROPERTIES_PATH, 'utf8');
const rustLib = readFileSync(RUST_LIB_PATH, 'utf8');
const invokes = parseInvokesEnum(appProperties);
const registered = parseTauriRegisteredCommands(rustLib);
const failures: string[] = [];

const frontendOnly = [...invokes].filter((command) => !registered.has(command)).toSorted();
const registeredOnly = [...registered].filter((command) => !invokes.has(command)).toSorted();
const unclassifiedFrontendOnly = frontendOnly.filter((command) => !(command in knownFrontendOnlyInvokes));
const unclassifiedRegisteredOnly = registeredOnly.filter((command) => !(command in knownRegisteredStringInvokes));
const staleFrontendAllowlist = Object.keys(knownFrontendOnlyInvokes).filter(
  (command) => !frontendOnly.includes(command),
);
const staleRegisteredAllowlist = Object.keys(knownRegisteredStringInvokes).filter(
  (command) => !registeredOnly.includes(command),
);

if (unclassifiedFrontendOnly.length > 0) {
  failures.push(`Invokes without Rust registration: ${unclassifiedFrontendOnly.join(', ')}`);
}
if (unclassifiedRegisteredOnly.length > 0) {
  failures.push(`Registered Rust commands missing Invokes enum entries: ${unclassifiedRegisteredOnly.join(', ')}`);
}
if (staleFrontendAllowlist.length > 0) {
  failures.push(`Remove stale frontend-only allowlist entries: ${staleFrontendAllowlist.join(', ')}`);
}
if (staleRegisteredAllowlist.length > 0) {
  failures.push(`Remove stale registered-only allowlist entries: ${staleRegisteredAllowlist.join(', ')}`);
}
if (invokes.has('run_raw_open_edit_export_proof')) {
  failures.push('Validation-only run_raw_open_edit_export_proof must not be exposed through Invokes.');
}
if (registered.has('run_raw_open_edit_export_proof')) {
  failures.push('Default Tauri command registration must omit validation-only run_raw_open_edit_export_proof.');
}
if (!rustLib.includes('#[cfg(feature = "validation-harness")]')) {
  failures.push('Validation-only Tauri commands must use a validation-harness cfg gate.');
}

if (failures.length > 0) {
  console.error('Tauri command registration drift failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `tauri command registration ok (invokes=${invokes.size}, registered=${registered.size}, known-drift=${
    frontendOnly.length + registeredOnly.length
  })`,
);

function parseInvokesEnum(source: string): Set<string> {
  const body = /export enum Invokes \{(?<body>[\s\S]*?)\n\}/u.exec(source)?.groups?.body;
  if (body === undefined) throw new Error('Unable to locate Invokes enum.');

  return new Set(
    [...body.matchAll(/\b[A-Za-z0-9]+\s*=\s*'(?<command>[^']+)'/gu)].map((match) =>
      commandNameSchema.parse(match.groups?.command),
    ),
  );
}

function parseTauriRegisteredCommands(source: string): Set<string> {
  const body = /generate_handler!\s*\[(?<body>[\s\S]*?)\]\s*\)/u.exec(source)?.groups?.body;
  if (body === undefined) throw new Error('Unable to locate tauri::generate_handler registration.');
  const defaultBody = body.replace(/#\[cfg\(feature = "validation-harness"\)\]\s*[A-Za-z0-9_:]+,?/gu, '');

  const commands = defaultBody
    .split(/,|\n/u)
    .map((entry) => entry.replace(/\/\/.*$/u, '').trim())
    .filter(Boolean)
    .filter((entry) => !entry.startsWith('#['))
    .map((entry) => entry.split('::').at(-1))
    .filter((entry): entry is string => entry !== undefined)
    .map((entry) => commandNameSchema.parse(entry));

  return new Set(commands);
}
