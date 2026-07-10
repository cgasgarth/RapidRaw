import { describe, expect, test } from 'bun:test';

import {
  isViewerDrag,
  resolveViewerInput,
  resolveViewerWheelIntent,
  shouldActivateTemporaryHand,
  shouldAllowViewerImageNavigation,
  VIEWER_DRAG_THRESHOLD_PX,
} from '../../../src/components/panel/editor/viewerInputResolver.ts';

const resolve = (overrides: Partial<Parameters<typeof resolveViewerInput>[0]> = {}) =>
  resolveViewerInput({
    activeTool: 'none',
    button: 0,
    focusContext: 'viewer',
    isDragging: false,
    isTemporaryHand: false,
    pointerCount: 1,
    pointerType: 'mouse',
    zoomed: false,
    ...overrides,
  });

describe('viewer input resolver', () => {
  test('gives editing tools first claim on primary single-pointer gestures', () => {
    expect(resolve({ activeTool: 'crop' })).toMatchObject({
      cursor: 'crosshair',
      owner: 'active-tool',
      reason: 'active-tool',
      shouldCapturePointer: false,
    });
    expect(resolve({ activeTool: 'brush', pointerType: 'touch' }).owner).toBe('active-tool');
    expect(resolve({ activeTool: 'retouch' }).owner).toBe('active-tool');
  });

  test('keeps temporary hand and middle mouse available over active tools', () => {
    expect(resolve({ activeTool: 'brush', isTemporaryHand: true })).toMatchObject({
      cursor: 'grab',
      owner: 'viewer-pan',
      reason: 'temporary-hand',
      shouldCapturePointer: true,
    });
    expect(resolve({ activeTool: 'crop', button: 1 })).toMatchObject({
      owner: 'viewer-pan',
      reason: 'middle-button',
    });
    expect(resolve({ activeTool: 'mask', pointerCount: 2, pointerType: 'touch' })).toMatchObject({
      owner: 'viewer-pan',
      reason: 'two-finger-pan',
    });
  });

  test('does not activate temporary hand while editable controls or modals own input', () => {
    expect(shouldActivateTemporaryHand({ focusContext: 'viewer', key: ' ' })).toBe(true);
    expect(shouldActivateTemporaryHand({ focusContext: 'editable', key: ' ' })).toBe(false);
    expect(resolve({ focusContext: 'modal', isTemporaryHand: true })).toMatchObject({
      cursor: 'progress',
      owner: 'blocked',
      reason: 'modal-blocked',
    });
  });

  test('provides stable cursor state and a shared drag threshold', () => {
    expect(resolve({ zoomed: false }).cursor).toBe('zoom-in');
    expect(resolve({ zoomed: true }).cursor).toBe('zoom-out');
    expect(resolve({ isDragging: true, isTemporaryHand: true }).cursor).toBe('grabbing');
    expect(isViewerDrag({ x: 0, y: 0 }, { x: VIEWER_DRAG_THRESHOLD_PX, y: 0 })).toBe(false);
    expect(isViewerDrag({ x: 0, y: 0 }, { x: VIEWER_DRAG_THRESHOLD_PX + 0.1, y: 0 })).toBe(true);
  });

  test('follows the explicit wheel input preference', () => {
    expect(resolveViewerWheelIntent({ ctrlKey: false, inputMode: 'mouse' })).toBe('zoom');
    expect(resolveViewerWheelIntent({ ctrlKey: false, inputMode: 'trackpad' })).toBe('pan');
    expect(resolveViewerWheelIntent({ ctrlKey: true, inputMode: 'trackpad' })).toBe('zoom');
  });

  test('keeps image navigation out of active viewer gestures and control-owned keys', () => {
    expect(shouldAllowViewerImageNavigation({ controlOwnsKey: false, isViewerGestureDragging: false })).toBe(true);
    expect(shouldAllowViewerImageNavigation({ controlOwnsKey: true, isViewerGestureDragging: false })).toBe(false);
    expect(shouldAllowViewerImageNavigation({ controlOwnsKey: false, isViewerGestureDragging: true })).toBe(false);
  });
});
