import type { KonvaEventObject } from 'konva/lib/Node';

export type ViewerKonvaPointerEvent = KonvaEventObject<MouseEvent | PointerEvent | TouchEvent>;
export type ViewerPointerMoveEvent = ViewerKonvaPointerEvent | MouseEvent | TouchEvent;
export type ViewerPointerEndEvent = ViewerKonvaPointerEvent | MouseEvent | TouchEvent;

export const isViewerKonvaPointerEvent = (event: ViewerPointerMoveEvent): event is ViewerKonvaPointerEvent =>
  'evt' in event && 'target' in event;
