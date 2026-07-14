import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { InteractivePatch } from '../../../store/useEditorStore';

const cssPercent = (value: number): string => `${String(value)}%`;
interface PreviewLayerValue {
  url: string;
}

interface SvgPreviewLayer<T extends PreviewLayerValue> {
  id: string;
  opacity: 0 | 1;
  owner: string;
  status: 'loaded' | 'loading' | 'visible';
  value: T;
}

interface SvgPreviewHandoffState<T extends PreviewLayerValue> {
  active: SvgPreviewLayer<T> | null;
  retired: SvgPreviewLayer<T>[];
  retiringActiveId: string | null;
  scopeKey: string;
  successor: SvgPreviewLayer<T> | null;
}

interface SvgPreviewHandoffOptions<T extends PreviewLayerValue> {
  initiallyVisible: boolean;
  ownerPrefix: string;
  retainActiveWithoutTarget: boolean;
  scopeKey: string;
  target: T | null;
  targetKey: string | null;
  reducedMotion: boolean;
  onClaim: (owner: string, url: string) => void;
  onRelease: (owner: string, url: string) => void;
}

const createSvgPreviewLayer = <T extends PreviewLayerValue>(
  ownerPrefix: string,
  scopeKey: string,
  value: T,
  opacity: 0 | 1,
): SvgPreviewLayer<T> => ({
  id: value.url,
  opacity,
  owner: `${ownerPrefix}:${scopeKey}:${value.url}`,
  status: 'loading',
  value,
});

const activeLayersForSvgPreviewHandoff = <T extends PreviewLayerValue>(state: SvgPreviewHandoffState<T>) => [
  ...(state.active ? [state.active] : []),
  ...(state.successor ? [state.successor] : []),
];

const layersForSvgPreviewHandoff = <T extends PreviewLayerValue>(state: SvgPreviewHandoffState<T>) => [
  ...activeLayersForSvgPreviewHandoff(state),
  ...state.retired,
];

const settleSvgPreviewSuccessor = <T extends PreviewLayerValue>(
  state: SvgPreviewHandoffState<T>,
  successorId: string,
): SvgPreviewHandoffState<T> => {
  if (state.successor?.id !== successorId) return state;
  return {
    ...state,
    active: { ...state.successor, opacity: 1, status: 'visible' },
    retired: state.active ? [...state.retired, state.active] : state.retired,
    retiringActiveId: null,
    successor: null,
  };
};

function useSvgPreviewHandoff<T extends PreviewLayerValue>({
  initiallyVisible,
  onClaim,
  onRelease,
  ownerPrefix,
  reducedMotion,
  retainActiveWithoutTarget,
  scopeKey,
  target,
  targetKey,
}: SvgPreviewHandoffOptions<T>) {
  const [state, setState] = useState<SvgPreviewHandoffState<T>>(() => ({
    active: initiallyVisible && target ? createSvgPreviewLayer(ownerPrefix, scopeKey, target, 1) : null,
    retired: [],
    retiringActiveId: null,
    scopeKey,
    successor: !initiallyVisible && target ? createSvgPreviewLayer(ownerPrefix, scopeKey, target, 0) : null,
  }));
  const onClaimRef = useRef(onClaim);
  const onReleaseRef = useRef(onRelease);
  const ownedLayersRef = useRef<SvgPreviewLayer<T>[]>([]);

  useLayoutEffect(() => {
    onClaimRef.current = onClaim;
    onReleaseRef.current = onRelease;
  }, [onClaim, onRelease]);

  useLayoutEffect(() => {
    setState((current) => {
      if (current.scopeKey !== scopeKey) {
        return {
          active: initiallyVisible && target ? createSvgPreviewLayer(ownerPrefix, scopeKey, target, 1) : null,
          retired: [...current.retired, ...activeLayersForSvgPreviewHandoff(current)],
          retiringActiveId: null,
          scopeKey,
          successor: !initiallyVisible && target ? createSvgPreviewLayer(ownerPrefix, scopeKey, target, 0) : null,
        };
      }

      if (!target) {
        if (retainActiveWithoutTarget) return current;
        return {
          ...current,
          active: null,
          retired: [...current.retired, ...activeLayersForSvgPreviewHandoff(current)],
          retiringActiveId: null,
          successor: null,
        };
      }

      if (current.successor?.id === target.url || (current.active?.id === target.url && !current.successor)) {
        return current;
      }

      const staleSuccessor = current.successor ? [current.successor] : [];
      if (!current.active) {
        return {
          ...current,
          retired: [...current.retired, ...staleSuccessor],
          successor: createSvgPreviewLayer(ownerPrefix, scopeKey, target, 0),
        };
      }

      return {
        ...current,
        retired: [...current.retired, ...staleSuccessor],
        successor: createSvgPreviewLayer(ownerPrefix, scopeKey, target, 0),
      };
    });
  }, [initiallyVisible, ownerPrefix, retainActiveWithoutTarget, scopeKey, target, targetKey]);

  useLayoutEffect(() => {
    const ownedLayers = layersForSvgPreviewHandoff(state);
    ownedLayersRef.current = ownedLayers;
    for (const layer of ownedLayers) {
      if (!state.retired.includes(layer)) {
        onClaimRef.current(layer.owner, layer.value.url);
      }
    }
  }, [state]);

  useEffect(() => {
    if (state.retired.length === 0) return;
    for (const layer of state.retired) {
      onReleaseRef.current(layer.owner, layer.value.url);
    }
    setState((current) => (current.retired === state.retired ? { ...current, retired: [] } : current));
  }, [state.retired]);

  useEffect(
    () => () => {
      for (const layer of ownedLayersRef.current) {
        onReleaseRef.current(layer.owner, layer.value.url);
      }
    },
    [],
  );

  const settleSuccessor = useCallback((successorId: string) => {
    setState((current) => settleSvgPreviewSuccessor(current, successorId));
  }, []);

  const handleSuccessorLoad = useCallback((successorId: string) => {
    setState((current) => {
      if (current.successor?.id !== successorId || current.successor.status !== 'loading') return current;
      return { ...current, successor: { ...current.successor, status: 'loaded' } };
    });
  }, []);

  const handleSuccessorError = useCallback((successorId: string) => {
    setState((current) => {
      if (current.successor?.id !== successorId) return current;
      return { ...current, retired: [...current.retired, current.successor], successor: null };
    });
  }, []);

  useEffect(() => {
    const successor = state.successor;
    if (!successor || successor.status !== 'loaded') return;

    let frame2: number | null = null;
    const frame1 = requestAnimationFrame(() => {
      setState((current) => {
        if (current.successor?.id !== successor.id) return current;
        return { ...current, successor: { ...current.successor, opacity: 1, status: 'visible' } };
      });
      if (reducedMotion) {
        frame2 = requestAnimationFrame(() => {
          settleSuccessor(successor.id);
        });
      }
    });

    return () => {
      cancelAnimationFrame(frame1);
      if (frame2 !== null) cancelAnimationFrame(frame2);
    };
  }, [reducedMotion, settleSuccessor, state.successor]);

  const beginActiveRetirement = useCallback(() => {
    setState((current) => {
      const retiredSuccessor = current.successor ? [current.successor] : [];
      if (!current.active) {
        return retiredSuccessor.length > 0
          ? { ...current, retired: [...current.retired, ...retiredSuccessor], successor: null }
          : current;
      }
      if (current.retiringActiveId === current.active.id && !current.successor) return current;
      return {
        ...current,
        active: { ...current.active, opacity: 0 },
        retired: [...current.retired, ...retiredSuccessor],
        retiringActiveId: current.active.id,
        successor: null,
      };
    });
  }, []);

  const retireActive = useCallback((activeId: string) => {
    setState((current) => {
      if (current.active?.id !== activeId || current.retiringActiveId !== activeId) return current;
      return {
        ...current,
        active: null,
        retired: [...current.retired, current.active],
        retiringActiveId: null,
      };
    });
  }, []);

  useEffect(() => {
    const activeId = state.retiringActiveId;
    if (!reducedMotion || !activeId) return;

    let frame2: number | null = null;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        retireActive(activeId);
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      if (frame2 !== null) cancelAnimationFrame(frame2);
    };
  }, [reducedMotion, retireActive, state.retiringActiveId]);

  const handleTransitionEnd = useCallback((layerId: string) => {
    setState((current) => {
      if (current.successor?.id === layerId) return settleSvgPreviewSuccessor(current, layerId);
      if (current.active?.id === layerId && current.retiringActiveId === layerId) {
        return {
          ...current,
          active: null,
          retired: [...current.retired, current.active],
          retiringActiveId: null,
        };
      }
      return current;
    });
  }, []);

  return { beginActiveRetirement, handleSuccessorError, handleSuccessorLoad, handleTransitionEnd, state };
}

const useReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateReducedMotion = () => setReducedMotion(mediaQuery.matches);
    updateReducedMotion();
    mediaQuery.addEventListener('change', updateReducedMotion);
    return () => {
      mediaQuery.removeEventListener('change', updateReducedMotion);
    };
  }, []);

  return reducedMotion;
};

interface SvgPreviewHandoffProps {
  baseScopeKey: string;
  baseSource: string | null;
  incomingPatch: InteractivePatch | null;
  isCpuPreviewVisible: boolean;
  isMaxZoom: boolean | undefined;
  patchScopeKey: string;
  reducedMotion?: boolean | undefined;
  releaseUrl: (owner: string, url: string) => void;
  retainUrl: (owner: string, url: string) => void;
}

export function SvgPreviewHandoff({
  baseScopeKey,
  baseSource,
  incomingPatch,
  isCpuPreviewVisible,
  isMaxZoom,
  patchScopeKey,
  reducedMotion: reducedMotionOverride,
  releaseUrl,
  retainUrl,
}: SvgPreviewHandoffProps) {
  const reducedMotionPreference = useReducedMotion();
  const reducedMotion = reducedMotionOverride ?? reducedMotionPreference;
  const baseTarget = useMemo(() => (baseSource ? { url: baseSource } : null), [baseSource]);
  const baseHandoff = useSvgPreviewHandoff({
    initiallyVisible: true,
    onClaim: retainUrl,
    onRelease: releaseUrl,
    ownerPrefix: 'base',
    reducedMotion,
    retainActiveWithoutTarget: false,
    scopeKey: baseScopeKey,
    target: baseTarget,
    targetKey: baseSource,
  });
  const patchHandoff = useSvgPreviewHandoff({
    initiallyVisible: false,
    onClaim: retainUrl,
    onRelease: releaseUrl,
    ownerPrefix: 'patch',
    reducedMotion,
    retainActiveWithoutTarget: true,
    scopeKey: patchScopeKey,
    target: incomingPatch,
    targetKey: incomingPatch?.url ?? null,
  });
  const baseSuccessorIsVisible = baseHandoff.state.successor?.opacity === 1;

  useEffect(() => {
    if (!incomingPatch && baseSuccessorIsVisible) {
      patchHandoff.beginActiveRetirement();
    }
  }, [baseSuccessorIsVisible, incomingPatch, patchHandoff.beginActiveRetirement]);

  if (!isCpuPreviewVisible) return null;

  const imageRendering = isMaxZoom ? 'pixelated' : 'auto';
  const transition = reducedMotion ? undefined : 'opacity 150ms ease-in-out';
  const baseLayers = [
    ...(baseHandoff.state.active ? [baseHandoff.state.active] : []),
    ...(baseHandoff.state.successor ? [baseHandoff.state.successor] : []),
  ];
  const patchLayers = [
    ...(patchHandoff.state.active ? [patchHandoff.state.active] : []),
    ...(patchHandoff.state.successor ? [patchHandoff.state.successor] : []),
  ];

  return (
    <>
      {baseLayers.map((layer) => (
        <image
          data-preview-layer-id={layer.id}
          data-preview-layer-role="base"
          data-preview-source-identity={baseScopeKey}
          data-testid="svg-preview-base-layer"
          height="100%"
          href={layer.value.url}
          key={`base:${layer.owner}`}
          onError={() => baseHandoff.handleSuccessorError(layer.id)}
          onLoad={() => baseHandoff.handleSuccessorLoad(layer.id)}
          onTransitionEnd={(event) => {
            if (event.propertyName === 'opacity') baseHandoff.handleTransitionEnd(layer.id);
          }}
          style={{ imageRendering, opacity: layer.opacity, transition }}
          width="100%"
          x="0"
          y="0"
        />
      ))}
      {patchLayers.map((layer) => (
        <image
          data-preview-full-height={layer.value.fullHeight}
          data-preview-full-width={layer.value.fullWidth}
          data-preview-layer-id={layer.id}
          data-preview-layer-role="patch"
          data-preview-pixel-height={layer.value.pixelHeight}
          data-preview-pixel-width={layer.value.pixelWidth}
          data-preview-source-identity={layer.value.sourceImagePath}
          data-testid="svg-preview-patch-layer"
          height={cssPercent(layer.value.normH * 100)}
          href={layer.value.url}
          key={`patch:${layer.owner}`}
          onError={() => patchHandoff.handleSuccessorError(layer.id)}
          onLoad={() => patchHandoff.handleSuccessorLoad(layer.id)}
          onTransitionEnd={(event) => {
            if (event.propertyName === 'opacity') patchHandoff.handleTransitionEnd(layer.id);
          }}
          preserveAspectRatio="none"
          style={{ imageRendering, opacity: layer.opacity, transition }}
          width={cssPercent(layer.value.normW * 100)}
          x={cssPercent(layer.value.normX * 100)}
          y={cssPercent(layer.value.normY * 100)}
        />
      ))}
    </>
  );
}
