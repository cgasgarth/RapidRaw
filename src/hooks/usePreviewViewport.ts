import {
  type CSSProperties,
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from 'react';

interface PreviewViewportOptions {
  maxZoom: number;
  minZoom: number;
  transitionLocked?: boolean;
  wheelSensitivity?: number;
  zoomStep: number;
}

interface PreviewViewportControls {
  containerRef: RefObject<HTMLDivElement | null>;
  handleMouseDown: (event: MouseEvent) => void;
  handleResetZoom: (event?: MouseEvent) => void;
  handleWheel: (event: WheelEvent) => void;
  imageTransformStyle: CSSProperties;
  isDragging: boolean;
  resetViewport: () => void;
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
}

const DEFAULT_WHEEL_SENSITIVITY = 0.001;
const DEFAULT_ZOOM = 1;
const DEFAULT_PAN = { x: 0, y: 0 };

export function usePreviewViewport({
  maxZoom,
  minZoom,
  transitionLocked = false,
  wheelSensitivity = DEFAULT_WHEEL_SENSITIVITY,
  zoomStep,
}: PreviewViewportOptions): PreviewViewportControls {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState(DEFAULT_PAN);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMousePositionRef = useRef(DEFAULT_PAN);

  useEffect(() => {
    if (!isDragging) return;

    const handleWindowMouseMove = (event: globalThis.MouseEvent) => {
      const dx = event.clientX - lastMousePositionRef.current.x;
      const dy = event.clientY - lastMousePositionRef.current.y;

      setPan((currentPan) => ({ x: currentPan.x + dx, y: currentPan.y + dy }));
      lastMousePositionRef.current = { x: event.clientX, y: event.clientY };
    };
    const handleWindowMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isDragging]);

  const clampZoom = useCallback(
    (nextZoom: number) => Math.min(Math.max(minZoom, nextZoom), maxZoom),
    [maxZoom, minZoom],
  );

  const resetViewport = useCallback(() => {
    setZoom(DEFAULT_ZOOM);
    setPan(DEFAULT_PAN);
  }, []);

  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (event.button !== 0) return;

    event.preventDefault();
    setIsDragging(true);
    lastMousePositionRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.stopPropagation();

      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = event.clientX - rect.left - rect.width / 2;
      const mouseY = event.clientY - rect.top - rect.height / 2;
      const nextZoom = clampZoom(zoom - event.deltaY * wheelSensitivity);
      const scaleRatio = nextZoom / zoom;
      const mouseFromCenterX = mouseX - pan.x;
      const mouseFromCenterY = mouseY - pan.y;

      setZoom(nextZoom);
      setPan({
        x: mouseX - mouseFromCenterX * scaleRatio,
        y: mouseY - mouseFromCenterY * scaleRatio,
      });
    },
    [clampZoom, pan.x, pan.y, wheelSensitivity, zoom],
  );

  const handleResetZoom = useCallback(
    (event?: MouseEvent) => {
      event?.stopPropagation();
      resetViewport();
    },
    [resetViewport],
  );

  const zoomIn = useCallback(() => {
    setZoom((currentZoom) => clampZoom(currentZoom + zoomStep));
  }, [clampZoom, zoomStep]);

  const zoomOut = useCallback(() => {
    setZoom((currentZoom) => clampZoom(currentZoom - zoomStep));
  }, [clampZoom, zoomStep]);

  const imageTransformStyle = useMemo<CSSProperties>(
    () => ({
      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
      transformOrigin: 'center center',
      transition: isDragging || transitionLocked ? 'none' : 'transform 0.1s ease-out',
    }),
    [isDragging, pan.x, pan.y, transitionLocked, zoom],
  );

  return {
    containerRef,
    handleMouseDown,
    handleResetZoom,
    handleWheel,
    imageTransformStyle,
    isDragging,
    resetViewport,
    zoom,
    zoomIn,
    zoomOut,
  };
}
