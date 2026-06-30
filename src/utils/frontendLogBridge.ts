import { invoke } from '@tauri-apps/api/core';

import { Invokes } from '../tauri/commands';

type FrontendLogLevel = 'debug' | 'info' | 'warn' | 'error';

type ConsoleMethod = (...args: unknown[]) => void;

const MAX_LOG_MESSAGE_LENGTH = 12000;
const MAX_SERIALIZE_DEPTH = 5;
const DEDUPE_WINDOW_MS = 1500;
const CONSOLE_LEVEL_MAP: Array<[keyof Console, FrontendLogLevel]> = [
  ['debug', 'debug'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
  ['log', 'info'],
];

const originalConsole = new Map<keyof Console, ConsoleMethod>();
const recentLogMap = new Map<string, number>();
let isInstalled = false;

function installViteErrorForwarding(): void {
  void import('./viteHotContext.mts')
    .then(({ onViteError }) => {
      onViteError((payload: unknown) => {
        const err = isPlainRecord(payload) ? (getRecordField(payload, 'err') ?? payload) : payload;
        sendToBackend('error', ['[vite:error:event]', err]);
      });
    })
    .catch(() => {
      // This hook is development-only; production builds may tree-shake or omit Vite HMR.
    });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRecordField(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function getStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = getRecordField(record, key);
  return typeof value === 'string' ? value : undefined;
}

function getNumberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = getRecordField(record, key);
  return typeof value === 'number' ? value : undefined;
}

function getObjectProperty(record: object, key: string): unknown {
  return Reflect.get(record, key);
}

function isViteLikeError(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return false;
  }

  return Boolean(
    getStringField(value, 'message') ||
      getStringField(value, 'stack') ||
      getStringField(value, 'frame') ||
      getStringField(value, 'plugin') ||
      getStringField(value, 'id') ||
      isPlainRecord(getRecordField(value, 'loc')),
  );
}

function formatViteErrorDetails(value: Record<string, unknown>): string {
  const lines: string[] = [];
  const message = getStringField(value, 'message');
  const plugin = getStringField(value, 'plugin');
  const id = getStringField(value, 'id');
  const stack = getStringField(value, 'stack');
  const frame = getStringField(value, 'frame');
  const loc = getRecordField(value, 'loc');

  if (message) {
    lines.push(`[vite:error] ${message}`);
  }
  if (plugin) {
    lines.push(`[vite:error] plugin: ${plugin}`);
  }
  if (id) {
    lines.push(`[vite:error] file: ${id}`);
  }
  if (isPlainRecord(loc)) {
    const file = getStringField(loc, 'file');
    const line = getNumberField(loc, 'line');
    const column = getNumberField(loc, 'column');
    const locParts = [file, line, column].filter((part) => part !== undefined);
    if (locParts.length > 0) {
      lines.push(`[vite:error] loc: ${locParts.join(':')}`);
    }
  }
  if (frame && frame.trim()) {
    lines.push(`[vite:error] frame:\n${frame.trim()}`);
  }
  if (stack && stack.trim()) {
    lines.push(`[vite:error] stack:\n${stack.trim()}`);
  }

  return lines.join('\n');
}

function extractViteDetails(args: unknown[]): string | null {
  const hasVitePrefix = args.some((arg) => typeof arg === 'string' && arg.includes('[vite]'));
  const candidate = args.find(isViteLikeError);

  if (!hasVitePrefix && !candidate) {
    return null;
  }

  if (candidate) {
    const details = formatViteErrorDetails(candidate);
    if (details) {
      return details;
    }
  }

  return null;
}

function shouldIgnoreMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  if (normalized.includes('[vite] failed to reload') && normalized.includes('see errors above')) {
    return true;
  }

  return false;
}

function shouldDropDuplicate(level: FrontendLogLevel, message: string): boolean {
  const now = Date.now();
  for (const [key, ts] of recentLogMap) {
    if (now - ts > DEDUPE_WINDOW_MS) {
      recentLogMap.delete(key);
    }
  }

  const dedupeKey = `${level}:${message}`;
  const previousTs = recentLogMap.get(dedupeKey);
  if (previousTs && now - previousTs <= DEDUPE_WINDOW_MS) {
    return true;
  }

  recentLogMap.set(dedupeKey, now);
  return false;
}

function serializeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth >= MAX_SERIALIZE_DEPTH) {
    return '[MaxDepth]';
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: serializeValue((value as Error & { cause?: unknown }).cause, depth + 1, seen),
      ...Object.fromEntries(
        Object.getOwnPropertyNames(value).map((key) => [
          key,
          serializeValue(getObjectProperty(value, key), depth + 1, seen),
        ]),
      ),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item, depth + 1, seen));
  }

  if (value instanceof Event) {
    const eventRecord: Record<string, unknown> = {
      type: value.type,
    };

    for (const key of Object.getOwnPropertyNames(value)) {
      eventRecord[key] = serializeValue(getObjectProperty(value, key), depth + 1, seen);
    }

    return eventRecord;
  }

  if (isPlainRecord(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    const output: Record<string, unknown> = {};
    const keys = new Set<string>([...Object.keys(value), ...Object.getOwnPropertyNames(value)]);
    for (const key of keys) {
      output[key] = serializeValue(value[key], depth + 1, seen);
    }
    return output;
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (typeof value === 'bigint') {
    return `${value.toString()}n`;
  }

  return value;
}

function stringifyArg(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return JSON.stringify(serializeValue(value, 0, new WeakSet()));
  }

  try {
    return JSON.stringify(serializeValue(value, 0, new WeakSet()));
  } catch {
    return String(value);
  }
}

function formatLogMessage(args: unknown[]): string {
  const baseMessage = args.map(stringifyArg).join(' ');
  const viteDetails = extractViteDetails(args);
  const message = viteDetails ? `${baseMessage}\n${viteDetails}` : baseMessage;

  if (message.length <= MAX_LOG_MESSAGE_LENGTH) {
    return message;
  }

  return `${message.slice(0, MAX_LOG_MESSAGE_LENGTH)}… [truncated]`;
}

function sendToBackend(level: FrontendLogLevel, args: unknown[]): void {
  const message = formatLogMessage(args);
  if (!message || shouldIgnoreMessage(message) || shouldDropDuplicate(level, message)) {
    return;
  }

  void invoke(Invokes.FrontendLog, {
    level,
    message,
  }).catch(() => {
    // Prevent recursion if backend logging channel is unavailable.
  });
}

export function installFrontendLogBridge(): void {
  if (isInstalled || typeof window === 'undefined') {
    return;
  }
  isInstalled = true;

  for (const [methodName, level] of CONSOLE_LEVEL_MAP) {
    const original = console[methodName];
    if (typeof original !== 'function') {
      continue;
    }

    const typedOriginal = original.bind(console) as ConsoleMethod;
    originalConsole.set(methodName, typedOriginal);

    (console[methodName] as ConsoleMethod) = (...args: unknown[]) => {
      typedOriginal(...args);
      sendToBackend(level, args);
    };
  }

  window.addEventListener('error', (event) => {
    const payload: unknown[] = [
      event.message || 'Unhandled window error',
      event.filename ? `at ${event.filename}:${String(event.lineno)}:${String(event.colno)}` : undefined,
      event.error ?? undefined,
      {
        type: event.type,
        timeStamp: event.timeStamp,
      },
    ].filter(Boolean);

    sendToBackend('error', payload);
  });

  window.addEventListener('unhandledrejection', (event) => {
    sendToBackend('error', ['Unhandled promise rejection', event.reason]);
  });

  installViteErrorForwarding();
}
