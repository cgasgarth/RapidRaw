import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Crop, PercentCrop } from 'react-image-crop';
import {
  type CropGeometryOverlayDescriptor,
  type CropStraightenControllerTransition,
  type CropStraightenSessionIdentity,
  createCropGeometryOverlayDescriptor,
  createCropStraightenController,
  cropStraightenPointFromSurface,
  isCropStraightenSessionCurrent,
} from './cropStraightenController';
import { isViewerSurfacePointerEvent, type ViewerSurfaceInputEvent } from './viewerInputRouter';

interface UseCropStraightenControllerInput {
  readonly onCropChange: (crop: Crop, percentCrop: PercentCrop) => void;
  readonly onCropComplete: (crop: Crop, percentCrop: PercentCrop, identity: CropStraightenSessionIdentity) => void;
  readonly onCropStart: () => void;
  readonly onStraighten: (correctionDegrees: number, identity: CropStraightenSessionIdentity) => void;
  readonly renderSize: { readonly height: number; readonly width: number } | null;
  readonly rotationDegrees: number;
  readonly session: CropStraightenSessionIdentity | null;
}

export interface CropStraightenControllerBinding {
  readonly descriptor: CropGeometryOverlayDescriptor | null;
  handleCropChange(crop: Crop, percentCrop: PercentCrop): void;
  handleCropComplete(crop: Crop, percentCrop: PercentCrop): void;
  handleInputEvent(event: ViewerSurfaceInputEvent): void;
}

/** Owns crop/straighten transitions; the overlay surface only renders descriptors and emits semantic callbacks. */
export const useCropStraightenController = ({
  onCropChange,
  onCropComplete,
  onCropStart,
  onStraighten,
  renderSize,
  rotationDegrees,
  session,
}: UseCropStraightenControllerInput): CropStraightenControllerBinding => {
  const controller = useMemo(() => createCropStraightenController(), []);
  const [transition, setTransition] = useState<CropStraightenControllerTransition | null>(null);
  const currentRef = useRef({
    onCropChange,
    onCropComplete,
    onCropStart,
    onStraighten,
    renderSize,
    rotationDegrees,
    session,
  });
  currentRef.current = {
    onCropChange,
    onCropComplete,
    onCropStart,
    onStraighten,
    renderSize,
    rotationDegrees,
    session,
  };

  const apply = useCallback((next: CropStraightenControllerTransition, publish = true) => {
    if (publish) setTransition(next);
    const current = currentRef.current;
    for (const command of next.commands) {
      if (command.type === 'crop-started') current.onCropStart();
      else if (command.type === 'crop-changed') current.onCropChange(command.crop, command.percentCrop);
      else if (command.type === 'crop-completed')
        current.onCropComplete(command.crop, command.percentCrop, command.identity);
      else if (command.type === 'straighten-committed')
        current.onStraighten(command.correctionDegrees, command.identity);
    }
  }, []);

  const fingerprint = session === null ? 'none' : JSON.stringify(session);
  useLayoutEffect(() => {
    apply(controller.dispatch({ session: currentRef.current.session, type: 'session-installed' }));
  }, [apply, controller, fingerprint]);
  useEffect(
    () => () => {
      apply(controller.dispatch({ reason: 'unmount', type: 'cancelled' }), false);
    },
    [apply, controller],
  );

  const handleInputEvent = useCallback(
    (event: ViewerSurfaceInputEvent) => {
      const current = currentRef.current;
      const identity = current.session;
      if (event.type === 'blur' || event.type === 'escape') {
        apply(
          controller.dispatch({ ...(identity === null ? {} : { identity }), reason: event.type, type: 'cancelled' }),
        );
        return;
      }
      if (!isViewerSurfacePointerEvent(event) || identity === null) return;
      if (identity.tool === 'crop') {
        if (event.type === 'pointerdown' && event.button === 0) {
          apply(controller.dispatch({ identity, type: 'crop-started' }));
        }
        return;
      }
      if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
        apply(
          controller.dispatch({
            identity,
            pointerId: event.pointerId,
            reason: event.type === 'pointercancel' ? 'pointer-cancel' : 'lost-pointer-capture',
            type: 'cancelled',
          }),
        );
        return;
      }
      const size = current.renderSize;
      if (size === null) return;
      const point = cropStraightenPointFromSurface(event, size);
      if (point === null) return;
      if (event.type === 'pointerdown') {
        if (event.button !== 0) return;
        apply(
          controller.dispatch({
            identity,
            point,
            pointerId: event.pointerId,
            renderSize: size,
            rotationDegrees: current.rotationDegrees,
            type: 'pointer-started',
          }),
        );
      } else {
        apply(
          controller.dispatch({
            identity,
            point,
            pointerId: event.pointerId,
            type: event.type === 'pointermove' ? 'pointer-moved' : 'pointer-ended',
          }),
        );
      }
    },
    [apply, controller],
  );

  const dispatchCrop = useCallback(
    (
      identity: CropStraightenSessionIdentity | null,
      type: 'crop-changed' | 'crop-completed',
      crop: Crop,
      percentCrop: PercentCrop,
    ) => {
      if (identity?.tool !== 'crop') return;
      apply(controller.dispatch({ crop, identity, percentCrop, type }));
    },
    [apply, controller],
  );

  const currentSize = renderSize;
  const currentOverlay =
    session !== null &&
    transition?.state.session !== null &&
    transition?.state.session !== undefined &&
    isCropStraightenSessionCurrent(session, transition.state.session)
      ? transition.overlay
      : null;
  const descriptor =
    session === null || currentSize === null
      ? null
      : createCropGeometryOverlayDescriptor(session, currentSize, currentOverlay);
  return {
    descriptor,
    handleCropChange: (crop, percentCrop) => dispatchCrop(session, 'crop-changed', crop, percentCrop),
    handleCropComplete: (crop, percentCrop) => dispatchCrop(session, 'crop-completed', crop, percentCrop),
    handleInputEvent,
  };
};
