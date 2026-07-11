import { invoke } from '@tauri-apps/api/core';
import { Eraser, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  type FocusRetouchSession,
  focusRetouchSessionSchema,
} from '../../../schemas/focus-stack/focusStackRetouchSchemas';
import { useUIStore } from '../../../store/useUIStore';
import { Invokes } from '../../../tauri/commands';

interface Props {
  packagePath: string;
}

export function FocusStackRetouchPanel({ packagePath }: Props) {
  const [session, setSession] = useState<FocusRetouchSession | null>(null);
  const [selectedSource, setSelectedSource] = useState(0);
  const [erase, setErase] = useState(false);
  const [radius, setRadius] = useState(24);
  const [hardness, setHardness] = useState(70);
  const [error, setError] = useState<string | null>(null);
  const setUI = useUIStore((state) => state.setUI);
  const canvasSession = useUIStore((state) => state.focusRetouchToolState.session);
  const isFocusStack = packagePath.includes('.rrfocus');
  const runHistory = useCallback(
    async (direction: 'undo' | 'redo' | 'reset') => {
      try {
        const value = await invoke(Invokes.NavigateFocusStackRetouch, { request: { packagePath, direction } });
        setSession(focusRetouchSessionSchema.parse(value));
        setError(null);
      } catch (cause) {
        setError(String(cause));
      }
    },
    [packagePath],
  );

  useEffect(() => {
    if (canvasSession && canvasSession.revision?.revisionId !== session?.revision?.revisionId)
      setSession(canvasSession);
  }, [canvasSession, session?.revision?.revisionId]);

  useEffect(() => {
    if (!isFocusStack) return;
    void invoke(Invokes.OpenFocusStackRetouch, { request: { packagePath } })
      .then((value) => {
        setSession(focusRetouchSessionSchema.parse(value));
        setError(null);
      })
      .catch((cause) => setError(String(cause)));
  }, [isFocusStack, packagePath]);

  useEffect(() => {
    setUI({
      focusRetouchToolState: {
        active: isFocusStack,
        erase,
        hardnessPercent: hardness,
        packagePath,
        radiusPx: radius,
        selectedSource,
        session,
      },
    });
    return () => setUI((state) => ({ focusRetouchToolState: { ...state.focusRetouchToolState, active: false } }));
  }, [erase, hardness, isFocusStack, packagePath, radius, selectedSource, session, setUI]);

  if (!isFocusStack) return null;
  return (
    <div
      className="space-y-3 px-3 py-2"
      data-focus-retouch-mode={erase ? 'automatic' : 'source'}
      data-testid="focus-stack-retouch-panel"
    >
      {/* i18next-instrument-ignore */}
      <div className="flex gap-1" role="toolbar" aria-label="Focus stack retouch history">
        {/* i18next-instrument-ignore */}
        <button
          aria-label="Undo source override"
          disabled={!session?.canUndo}
          onClick={() => void runHistory('undo')}
          type="button"
        >
          <Undo2 size={15} />
        </button>
        {/* i18next-instrument-ignore */}
        <button
          aria-label="Redo source override"
          disabled={!session?.canRedo}
          onClick={() => void runHistory('redo')}
          type="button"
        >
          <Redo2 size={15} />
        </button>
        {/* i18next-instrument-ignore */}
        <button
          aria-label="Erase to automatic"
          aria-pressed={erase}
          onClick={() => setErase((value) => !value)}
          type="button"
        >
          <Eraser size={15} />
        </button>
        {/* i18next-instrument-ignore */}
        <button
          aria-label="Reset all overrides"
          disabled={!session?.revision}
          onClick={() => void runHistory('reset')}
          type="button"
        >
          <RotateCcw size={15} />
        </button>
      </div>
      {/* i18next-instrument-ignore */}
      <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Focus stack sources">
        {session?.sourceStatuses.map((status, index) => (
          <button
            aria-checked={selectedSource === index}
            disabled={status !== 'current'}
            key={index}
            onClick={() => {
              setSelectedSource(index);
              setErase(false);
            }}
            role="radio"
            title={`Source ${index + 1}: ${status}`}
            type="button"
          >
            <span className="block aspect-square bg-bg-tertiary" />
            <span className="text-[10px]">{index + 1}</span>
          </button>
        ))}
      </div>
      {/* i18next-instrument-ignore */}
      <label className="block text-xs">
        Size
        <input
          aria-label="Brush size"
          className="w-full"
          max={256}
          min={1}
          onChange={(event) => setRadius(Number(event.target.value))}
          type="range"
          value={radius}
        />
      </label>
      {/* i18next-instrument-ignore */}
      <label className="block text-xs">
        Hardness
        <input
          aria-label="Brush hardness"
          className="w-full"
          max={100}
          min={0}
          onChange={(event) => setHardness(Number(event.target.value))}
          type="range"
          value={hardness}
        />
      </label>
      <output
        className="block text-xs"
        data-selected-source={selectedSource}
        data-radius={radius}
        data-hardness={hardness}
      >
        {error ?? session?.renderStatus ?? 'rendering'}
      </output>
    </div>
  );
}
