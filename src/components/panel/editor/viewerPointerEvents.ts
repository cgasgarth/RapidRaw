import type { KonvaEventObject } from 'konva/lib/Node';

export type ViewerKonvaPointerEvent = KonvaEventObject<MouseEvent | PointerEvent | TouchEvent>;
export type ViewerPointerMoveEvent = ViewerKonvaPointerEvent | MouseEvent | TouchEvent;
export type ViewerPointerEndEvent = ViewerKonvaPointerEvent | MouseEvent | TouchEvent;
export type ViewerPointerType = 'mouse' | 'pen' | 'touch';

export const isViewerKonvaPointerEvent = (event: ViewerPointerMoveEvent): event is ViewerKonvaPointerEvent =>
  'evt' in event && 'target' in event;

export const viewerPointerIdentity = (event: MouseEvent | PointerEvent | TouchEvent) => {
  const pointerType: ViewerPointerType =
    'pointerType' in event && (event.pointerType === 'pen' || event.pointerType === 'touch')
      ? event.pointerType
      : 'touches' in event
        ? 'touch'
        : 'mouse';
  const touch = 'touches' in event ? (event.touches[0] ?? event.changedTouches[0]) : undefined;
  return { pointerId: 'pointerId' in event ? event.pointerId : touch ? touch.identifier + 1 : 1, pointerType };
};
