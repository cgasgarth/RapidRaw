import { describe, expect, test } from 'bun:test';

import {
  beginAppOperation,
  buildAppEventLogEntry,
  createAppEventErrorDetails,
  formatAppEventLogLine,
  logAppEvent,
  logAppOperationSuccess,
  redactPrivateLogText,
  setAppEventNativeLogForwarderForTest,
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

  test('forwards preview and Basic Tone edit events to native retrievable log lines', () => {
    const forwarded: Array<{ level: string; line: string }> = [];
    const originalInfo = console.info;
    console.info = () => {};
    setAppEventNativeLogForwarderForTest((level, line) => {
      forwarded.push({ level, line });
    });

    try {
      logAppEvent({
        action: 'render_editor_preview.start',
        component: 'editor.preview',
        details: {
          filePath: '/Users/example/Pictures/Capture One/Alaska/private-frame.nef',
          jobId: 4737,
          targetResolution: 1920,
        },
        domain: 'preview',
        level: 'info',
        operationId: 'preview_4737',
        timestamp: new Date('2026-07-01T12:00:00.000Z'),
        traceId: 'preview_trace_4737',
      });

      const editOperation = beginAppOperation({
        action: 'build_basic_tone_command',
        component: 'editor.edit-command',
        details: {
          changedKeys: ['exposure', 'contrast'],
          commandType: 'toneColor.setBasicTone',
          dryRun: true,
          imagePath: '/Users/example/Pictures/Capture One/Alaska/private-frame.nef',
        },
        domain: 'edit-command',
        operationId: 'command_basic_tone_4737',
        traceId: 'corr_basic_tone_4737',
      });
      logAppOperationSuccess(editOperation, {
        commandType: 'toneColor.setBasicTone',
        dryRun: true,
        schemaVersion: 1,
      });
    } finally {
      setAppEventNativeLogForwarderForTest(null);
      console.info = originalInfo;
    }

    expect(forwarded.length).toBe(3);
    expect(forwarded.every(({ level, line }) => level === 'info' && line.startsWith('[app-event] '))).toBe(true);
    expect(forwarded.some(({ line }) => line.includes('"action":"render_editor_preview.start"'))).toBe(true);
    expect(forwarded.some(({ line }) => line.includes('"action":"build_basic_tone_command.start"'))).toBe(true);
    expect(forwarded.some(({ line }) => line.includes('"action":"build_basic_tone_command.success"'))).toBe(true);
    expect(forwarded.map(({ line }) => line).join('\n')).toContain('.../private-frame.nef');
    expect(forwarded.map(({ line }) => line).join('\n')).not.toContain('/Users/example');
  });
});
