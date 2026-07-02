import { emptyTauriResponseSchema } from '../schemas/tauriResponseSchemas';
import { Invokes } from '../tauri/commands';
import { invokeWithSchema } from './tauriSchemaInvoke';

export type AppEventLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppEventErrorDetails {
  readonly code?: string | undefined;
  readonly message: string;
  readonly name?: string;
}

export interface AppEventLogEntry {
  readonly action: string;
  readonly component: string;
  readonly details?: Record<string, unknown>;
  readonly domain: string;
  readonly error?: AppEventErrorDetails;
  readonly level: AppEventLogLevel;
  readonly operationId?: string;
  readonly timestamp: string;
  readonly traceId?: string;
  readonly v: 1;
}

export interface AppEventLogInput {
  readonly action: string;
  readonly component: string;
  readonly details?: Record<string, unknown> | undefined;
  readonly domain: string;
  readonly error?: unknown;
  readonly level: AppEventLogLevel;
  readonly operationId?: string | undefined;
  readonly timestamp?: Date;
  readonly traceId?: string | undefined;
}

export interface AppOperationContext {
  readonly action: string;
  readonly component: string;
  readonly details: Record<string, unknown> | undefined;
  readonly domain: string;
  readonly operationId: string;
  readonly startedAtMs: number;
  readonly traceId: string;
}

export interface BeginAppOperationInput {
  readonly action: string;
  readonly component: string;
  readonly details?: Record<string, unknown> | undefined;
  readonly domain: string;
  readonly operationId?: string | undefined;
  readonly traceId?: string | undefined;
}

type AppEventNativeLogForwarder = (level: AppEventLogLevel, line: string) => void;

const APP_EVENT_PREFIX = '[app-event]';
const MAX_STRING_LENGTH = 320;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const MAX_DETAIL_KEYS = 20;
const MAX_DETAIL_ARRAY_ITEMS = 12;
const MAX_DETAIL_DEPTH = 3;
const DATA_URL_PATTERN = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;
const POSIX_PATH_PATTERN = /(?:\/[^/\s"'`{}[\]]+){2,}/g;
const WINDOWS_PATH_PATTERN = /[A-Za-z]:\\(?:[^\\\s"'`{}[\]]+\\)+[^\\\s"'`{}[\]]+/g;

let testNativeLogForwarder: AppEventNativeLogForwarder | null = null;

export function setAppEventNativeLogForwarderForTest(forwarder: AppEventNativeLogForwarder | null): void {
  testNativeLogForwarder = forwarder;
}

const generateId = (prefix: string): string => {
  const randomId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomId}`;
};

const basename = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
};

export const redactPrivateLogText = (value: string): string =>
  value
    .replace(DATA_URL_PATTERN, '[redacted-image-data-url]')
    .replace(WINDOWS_PATH_PATTERN, (match) => `...\\${basename(match)}`)
    .replace(POSIX_PATH_PATTERN, (match) => `.../${basename(match)}`);

const truncate = (value: string, maxLength: number): string => {
  const redacted = redactPrivateLogText(value);
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}...` : redacted;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const sanitizeDetailValue = (value: unknown, depth: number): unknown => {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return truncate(value, MAX_STRING_LENGTH);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Error) {
    return createAppEventErrorDetails(value);
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DETAIL_DEPTH) {
      return `[Array(${value.length})]`;
    }
    return value.slice(0, MAX_DETAIL_ARRAY_ITEMS).map((item) => sanitizeDetailValue(item, depth + 1));
  }

  if (isRecord(value)) {
    if (depth >= MAX_DETAIL_DEPTH) {
      return '[Object]';
    }

    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).slice(0, MAX_DETAIL_KEYS)) {
      output[key] = sanitizeDetailValue(value[key], depth + 1);
    }
    return output;
  }

  return truncate(String(value), MAX_STRING_LENGTH);
};

const sanitizeDetails = (details?: Record<string, unknown>): Record<string, unknown> | undefined => {
  if (!details) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(details).slice(0, MAX_DETAIL_KEYS)) {
    sanitized[key] = sanitizeDetailValue(details[key], 0);
  }
  return sanitized;
};

const getStringProperty = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const property = value[key];
  return typeof property === 'string' ? property : undefined;
};

export const createAppEventErrorDetails = (error: unknown): AppEventErrorDetails => {
  if (error instanceof Error) {
    const code = getStringProperty(error, 'code');
    return {
      message: truncate(error.message || error.name, MAX_ERROR_MESSAGE_LENGTH),
      name: error.name,
      ...(code ? { code } : {}),
    };
  }

  const code = getStringProperty(error, 'code');
  return {
    message: truncate(typeof error === 'string' ? error : String(error), MAX_ERROR_MESSAGE_LENGTH),
    ...(code ? { code } : {}),
  };
};

export const buildAppEventLogEntry = (input: AppEventLogInput): AppEventLogEntry => {
  const details = sanitizeDetails(input.details);
  return {
    action: input.action,
    component: input.component,
    ...(details ? { details } : {}),
    domain: input.domain,
    ...(input.error === undefined ? {} : { error: createAppEventErrorDetails(input.error) }),
    level: input.level,
    ...(input.operationId ? { operationId: input.operationId } : {}),
    timestamp: (input.timestamp ?? new Date()).toISOString(),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    v: 1,
  };
};

export const formatAppEventLogLine = (entry: AppEventLogEntry): string =>
  `${APP_EVENT_PREFIX} ${JSON.stringify(entry)}`;

function forwardAppEventToNativeLog(level: AppEventLogLevel, line: string): void {
  if (testNativeLogForwarder) {
    testNativeLogForwarder(level, line);
    return;
  }

  if (typeof window === 'undefined') {
    return;
  }

  void invokeWithSchema(
    Invokes.FrontendLog,
    {
      level,
      message: line,
    },
    emptyTauriResponseSchema,
  ).catch(() => {
    // Keep logging best-effort so missing native APIs cannot break editor actions.
  });
}

export function logAppEvent(input: AppEventLogInput): AppEventLogEntry {
  const entry = buildAppEventLogEntry(input);
  const line = formatAppEventLogLine(entry);
  const writer = entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.info;
  writer(line);
  forwardAppEventToNativeLog(entry.level, line);
  return entry;
}

export function beginAppOperation(input: BeginAppOperationInput): AppOperationContext {
  const operation: AppOperationContext = {
    action: input.action,
    component: input.component,
    details: input.details,
    domain: input.domain,
    operationId: input.operationId ?? generateId(`${input.domain}_op`),
    startedAtMs: performance.now(),
    traceId: input.traceId ?? generateId(`${input.domain}_trace`),
  };

  logAppEvent({
    action: `${operation.action}.start`,
    component: operation.component,
    details: operation.details,
    domain: operation.domain,
    level: 'info',
    operationId: operation.operationId,
    traceId: operation.traceId,
  });

  return operation;
}

export function logAppOperationSuccess(
  operation: AppOperationContext,
  details?: Record<string, unknown>,
): AppEventLogEntry {
  return logAppEvent({
    action: `${operation.action}.success`,
    component: operation.component,
    details: {
      ...details,
      durationMs: Math.round(performance.now() - operation.startedAtMs),
    },
    domain: operation.domain,
    level: 'info',
    operationId: operation.operationId,
    traceId: operation.traceId,
  });
}

export function logAppOperationFailure(operation: AppOperationContext, error: unknown): AppEventLogEntry {
  return logAppEvent({
    action: `${operation.action}.failure`,
    component: operation.component,
    details: {
      durationMs: Math.round(performance.now() - operation.startedAtMs),
    },
    domain: operation.domain,
    error,
    level: 'error',
    operationId: operation.operationId,
    traceId: operation.traceId,
  });
}
