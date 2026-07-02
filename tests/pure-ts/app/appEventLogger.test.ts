import { describe, expect, test } from 'bun:test';

import {
  buildAppEventLogEntry,
  createAppEventErrorDetails,
  formatAppEventLogLine,
  redactPrivateLogText,
} from '../../../src/utils/appEventLogger.ts';

describe('app event logger', () => {
  test('formats compact structured event lines with correlation fields', () => {
    const entry = buildAppEventLogEntry({
      action: 'render_editor_preview.start',
      component: 'editor.preview',
      details: {
        count: 1,
        filePath: '/Users/example/Pictures/private/session/image.nef',
      },
      domain: 'preview',
      level: 'info',
      operationId: 'preview_42',
      timestamp: new Date('2026-07-01T12:00:00.000Z'),
      traceId: 'trace_42',
    });

    expect(entry).toMatchObject({
      action: 'render_editor_preview.start',
      component: 'editor.preview',
      domain: 'preview',
      level: 'info',
      operationId: 'preview_42',
      timestamp: '2026-07-01T12:00:00.000Z',
      traceId: 'trace_42',
      v: 1,
    });
    expect(entry.details?.filePath).toBe('.../image.nef');
    expect(formatAppEventLogLine(entry)).toStartWith('[app-event] {"action":"render_editor_preview.start"');
  });

  test('redacts private image payloads and full paths from strings', () => {
    const text = redactPrivateLogText(
      'failed /Users/example/Pictures/private/session/image.nef data:image/jpeg;base64,abcdef123456',
    );

    expect(text).toContain('.../image.nef');
    expect(text).toContain('[redacted-image-data-url]');
    expect(text).not.toContain('/Users/example');
    expect(text).not.toContain('abcdef123456');
  });

  test('bounds error details without stack payloads', () => {
    const error = new Error(`Export failed for /Users/example/Pictures/private/session/image.nef ${'x'.repeat(800)}`);
    const details = createAppEventErrorDetails(error);

    expect(details.name).toBe('Error');
    expect(details.message.length).toBeLessThanOrEqual(503);
    expect(details.message).toContain('.../image.nef');
    expect(details.message).not.toContain('/Users/example');
    expect('stack' in details).toBe(false);
  });
});
