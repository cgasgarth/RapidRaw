import cx from 'clsx';
import { Bookmark, BookmarkPlus, Check, Pencil, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../../store/useEditorStore';
import { buildEditHistoryItems, type EditHistoryItem } from '../../../utils/editHistory';
import { editorChromeTokens } from '../../ui/editorChromeTokens';

const rowClassName =
  'flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-editor-focus-ring';

function getNextHistoryIndex(event: KeyboardEvent, current: number, last: number): number | null {
  if (event.key === 'ArrowDown') return Math.min(current + 1, last);
  if (event.key === 'ArrowUp') return Math.max(current - 1, 0);
  if (event.key === 'Home') return 0;
  if (event.key === 'End') return last;
  return null;
}

export function EditorHistorySection() {
  const history = useEditorStore((state) => state.history);
  const checkpoints = useEditorStore((state) => state.historyCheckpoints);
  const historyIndex = useEditorStore((state) => state.historyIndex);
  const goToHistoryIndex = useEditorStore((state) => state.goToHistoryIndex);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const items = useMemo(() => buildEditHistoryItems(history, checkpoints), [checkpoints, history]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [historyIndex]);

  const activate = (index: number, focus = false) => {
    goToHistoryIndex(index);
    if (focus) {
      requestAnimationFrame(() => activeRowRef.current?.focus());
    }
  };

  if (items.length === 0) {
    // i18next-instrument-ignore
    return <p className="px-3 py-4 text-xs text-text-secondary">No edits in this session.</p>;
  }

  return (
    /* i18next-instrument-ignore */
    <div aria-label="Edit history" className="max-h-72 overflow-y-auto py-1" role="listbox">
      {items.map((item) => {
        const isCurrent = item.historyIndex === historyIndex;
        const isFuture = item.historyIndex > historyIndex;
        return (
          <button
            aria-selected={isCurrent}
            className={cx(
              rowClassName,
              isCurrent && 'bg-editor-primary-active text-text-button',
              !isCurrent && 'hover:bg-editor-selected-quiet',
              isFuture && 'text-text-secondary opacity-60 hover:opacity-100',
            )}
            data-active={isCurrent}
            data-history-index={item.historyIndex}
            data-testid={isCurrent ? 'editor-sidebar-history-active-row' : 'editor-sidebar-history-row'}
            key={item.historyIndex}
            onClick={() => activate(item.historyIndex)}
            onKeyDown={(event) => {
              const nextIndex = getNextHistoryIndex(event, item.historyIndex, items.length - 1);
              if (nextIndex === null) return;
              event.preventDefault();
              activate(nextIndex, true);
            }}
            ref={isCurrent ? activeRowRef : undefined}
            role="option"
            tabIndex={isCurrent ? 0 : -1}
            type="button"
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span aria-hidden="true" className="shrink-0 tabular-nums opacity-60">
              {item.historyIndex + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function EditorSnapshotsSection() {
  const history = useEditorStore((state) => state.history);
  const checkpoints = useEditorStore((state) => state.historyCheckpoints);
  const historyIndex = useEditorStore((state) => state.historyIndex);
  const createCheckpoint = useEditorStore((state) => state.createHistoryCheckpoint);
  const renameCheckpoint = useEditorStore((state) => state.renameHistoryCheckpoint);
  const goToHistoryIndex = useEditorStore((state) => state.goToHistoryIndex);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const items = useMemo(() => buildEditHistoryItems(history, checkpoints), [checkpoints, history]);
  const snapshots = items.filter(
    (item): item is EditHistoryItem & { checkpoint: NonNullable<EditHistoryItem['checkpoint']> } =>
      item.checkpoint !== null,
  );
  const activeItem = items[historyIndex] ?? null;
  const activeSnapshot = snapshots.find((item) => item.historyIndex === historyIndex) ?? null;

  useEffect(() => {
    if (editingId !== null) inputRef.current?.focus();
  }, [editingId]);

  const beginRename = (item: (typeof snapshots)[number]) => {
    setEditingId(item.checkpoint.id);
    setEditingLabel(item.checkpoint.label);
  };

  const cancelRename = () => {
    const id = editingId;
    setEditingId(null);
    setEditingLabel('');
    requestAnimationFrame(() => {
      if (id) document.querySelector<HTMLButtonElement>(`[data-snapshot-rename="${id}"]`)?.focus();
    });
  };

  const commitRename = () => {
    if (editingId === null || !editingLabel.trim()) return;
    const id = editingId;
    renameCheckpoint(id, editingLabel);
    setEditingId(null);
    setEditingLabel('');
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-snapshot-rename="${id}"]`)?.focus());
  };

  return (
    <div className="py-1" data-testid="editor-sidebar-snapshots-content">
      <button
        className={cx(rowClassName, 'border-b border-editor-border hover:bg-editor-selected-quiet')}
        data-testid="editor-sidebar-snapshot-create"
        disabled={activeItem === null}
        onClick={() => {
          if (activeItem === null) return;
          if (activeSnapshot) {
            beginRename(activeSnapshot);
          } else {
            createCheckpoint(activeItem.label);
          }
        }}
        type="button"
      >
        <BookmarkPlus aria-hidden="true" className="shrink-0 text-text-secondary" size={14} />
        <span className="min-w-0 flex-1 truncate">
          {activeSnapshot ? 'Rename current snapshot' : 'Create session snapshot'}
        </span>
      </button>

      {snapshots.length === 0 ? (
        /* i18next-instrument-ignore */
        <p className="px-3 py-4 text-xs text-text-secondary" data-testid="editor-sidebar-snapshots-empty">
          No session snapshots.
        </p>
      ) : (
        /* i18next-instrument-ignore */
        <div aria-label="Session snapshots" className="max-h-56 overflow-y-auto" role="listbox">
          {snapshots.map((item) => {
            const isCurrent = item.historyIndex === historyIndex;
            const isEditing = item.checkpoint.id === editingId;
            return (
              <div
                className={cx(
                  'flex min-h-9 items-center gap-1 px-2',
                  isCurrent ? 'bg-editor-primary-active text-text-button' : 'hover:bg-editor-selected-quiet',
                )}
                data-testid={isCurrent ? 'editor-sidebar-snapshot-active-row' : 'editor-sidebar-snapshot-row'}
                key={item.checkpoint.id}
                role="none"
              >
                <Bookmark aria-hidden="true" className="shrink-0" size={13} />
                {isEditing ? (
                  <input
                    aria-label="Snapshot name"
                    className="h-7 min-w-0 flex-1 rounded border border-editor-border bg-editor-panel-well px-2 text-xs text-text-primary outline-none focus:ring-1 focus:ring-editor-focus-ring"
                    data-testid="editor-sidebar-snapshot-name-input"
                    onChange={(event) => setEditingLabel(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename();
                      if (event.key === 'Escape') cancelRename();
                    }}
                    ref={inputRef}
                    value={editingLabel}
                  />
                ) : (
                  <button
                    aria-selected={isCurrent}
                    className="min-w-0 flex-1 truncate py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
                    onClick={() => goToHistoryIndex(item.historyIndex)}
                    role="option"
                    type="button"
                  >
                    {item.checkpoint.label}
                  </button>
                )}
                {isEditing ? (
                  <>
                    <button
                      /* i18next-instrument-ignore */
                      aria-label="Save snapshot name"
                      className={cx(
                        editorChromeTokens.button.base,
                        editorChromeTokens.button.iconCompact,
                        editorChromeTokens.button.quiet,
                      )}
                      disabled={!editingLabel.trim()}
                      onClick={commitRename}
                      type="button"
                    >
                      <Check aria-hidden="true" size={13} />
                    </button>
                    <button
                      /* i18next-instrument-ignore */
                      aria-label="Cancel snapshot rename"
                      className={cx(
                        editorChromeTokens.button.base,
                        editorChromeTokens.button.iconCompact,
                        editorChromeTokens.button.quiet,
                      )}
                      onClick={cancelRename}
                      type="button"
                    >
                      <X aria-hidden="true" size={13} />
                    </button>
                  </>
                ) : (
                  <button
                    aria-label={`Rename ${item.checkpoint.label}`}
                    className={cx(
                      editorChromeTokens.button.base,
                      editorChromeTokens.button.iconCompact,
                      editorChromeTokens.button.quiet,
                    )}
                    data-snapshot-rename={item.checkpoint.id}
                    onClick={() => beginRename(item)}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
