import cx from 'clsx';
import { Bookmark, BookmarkPlus, Check, Pencil, Redo2, Trash2, Undo2, X } from 'lucide-react';
import { type KeyboardEvent, type MutableRefObject, useEffect, useMemo, useRef, useState } from 'react';
import type { EditDocumentV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import { useEditorStore } from '../../../store/useEditorStore';
import { buildEditHistoryItems, type EditHistoryItem } from '../../../utils/editHistory';
import {
  type EditorNamedSnapshot,
  readNamedSnapshots,
  snapshotDocumentEquals,
} from '../../../utils/editorNamedSnapshots';
import { editorChromeTokens } from '../../ui/editorChromeTokens';

const rowClassName =
  'flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-editor-focus-ring';

const formatCheckpointTime = (createdAt: string): string => {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp);
};

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
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const items = useMemo(() => buildEditHistoryItems(history, checkpoints), [checkpoints, history]);
  const currentIndex = items.length === 0 ? -1 : Math.min(Math.max(historyIndex, 0), items.length - 1);
  const canUndo = currentIndex > 0;
  const canRedo = currentIndex >= 0 && currentIndex < items.length - 1;
  const appliedItems = items.filter((item) => item.historyIndex <= currentIndex);
  const futureItems = items.filter((item) => item.historyIndex > currentIndex);

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
    return (
      <div className="px-3 py-3 text-xs text-text-secondary" data-testid="editor-sidebar-history-empty">
        <p>No edits in this session.</p>
        <p className="mt-1 text-[10px]">The base document is current.</p>
      </div>
    );
  }

  return (
    /* i18next-instrument-ignore */
    <div aria-label="Edit history" className="py-1" data-testid="editor-sidebar-history" role="region">
      <div className="flex items-center justify-between border-b border-editor-border px-2 py-1">
        <span className="text-[10px] tabular-nums text-text-secondary" data-testid="editor-history-position">
          {currentIndex < 0 ? 'Base' : `Step ${String(currentIndex + 1)} of ${String(items.length)}`}
        </span>
        <div aria-label="History commands" className="flex items-center gap-0.5" role="toolbar">
          <button
            aria-label="Undo history step"
            className={cx(
              editorChromeTokens.button.base,
              editorChromeTokens.button.iconCompact,
              editorChromeTokens.button.quiet,
            )}
            data-testid="editor-sidebar-history-undo"
            disabled={!canUndo}
            onClick={undo}
            title="Undo history step"
            type="button"
          >
            <Undo2 aria-hidden="true" size={13} />
          </button>
          <button
            aria-label="Redo history step"
            className={cx(
              editorChromeTokens.button.base,
              editorChromeTokens.button.iconCompact,
              editorChromeTokens.button.quiet,
            )}
            data-testid="editor-sidebar-history-redo"
            disabled={!canRedo}
            onClick={redo}
            title="Redo history step"
            type="button"
          >
            <Redo2 aria-hidden="true" size={13} />
          </button>
        </div>
      </div>
      <div aria-label="Edit history steps" className="max-h-72 overflow-y-auto" role="listbox">
        <HistoryGroup
          currentIndex={currentIndex}
          items={appliedItems}
          lastIndex={items.length - 1}
          onActivate={activate}
          rowRef={activeRowRef}
          title="Applied edits"
        />
        {futureItems.length > 0 ? (
          <HistoryGroup
            currentIndex={currentIndex}
            items={futureItems}
            lastIndex={items.length - 1}
            onActivate={activate}
            rowRef={activeRowRef}
            title="Redo branch"
          />
        ) : null}
      </div>
    </div>
  );
}

function HistoryGroup({
  currentIndex,
  items,
  lastIndex,
  onActivate,
  rowRef,
  title,
}: {
  currentIndex: number;
  items: readonly EditHistoryItem<EditDocumentV2>[];
  lastIndex: number;
  onActivate: (index: number, focus?: boolean) => void;
  rowRef: MutableRefObject<HTMLButtonElement | null>;
  title: string;
}) {
  if (items.length === 0) return null;
  return (
    <div aria-label={title} data-history-group={title === 'Redo branch' ? 'future' : 'applied'} role="group">
      <div className="px-3 pb-0.5 pt-1 text-[10px] font-medium uppercase leading-4 tracking-wide text-text-tertiary">
        {title}
      </div>
      {items.map((item) => {
        const isCurrent = item.historyIndex === currentIndex;
        const isFuture = item.historyIndex > currentIndex;
        const checkpointTime = item.checkpoint ? formatCheckpointTime(item.checkpoint.createdAt) : '';
        return (
          <button
            aria-current={isCurrent ? 'step' : undefined}
            aria-label={`${item.label}${isCurrent ? ', current step' : ''}`}
            aria-selected={isCurrent}
            className={cx(
              rowClassName,
              isCurrent && 'bg-editor-primary-active text-text-button',
              !isCurrent && 'hover:bg-editor-selected-quiet',
              isFuture && 'text-text-secondary opacity-60 hover:opacity-100',
            )}
            data-active={isCurrent}
            data-history-index={item.historyIndex}
            data-history-state={isCurrent ? 'current' : isFuture ? 'future' : 'applied'}
            data-testid={isCurrent ? 'editor-sidebar-history-active-row' : 'editor-sidebar-history-row'}
            key={item.historyIndex}
            onClick={() => onActivate(item.historyIndex)}
            onKeyDown={(event) => {
              const nextIndex = getNextHistoryIndex(event, item.historyIndex, lastIndex);
              if (nextIndex === null) return;
              event.preventDefault();
              onActivate(nextIndex, true);
            }}
            ref={isCurrent ? rowRef : undefined}
            role="option"
            tabIndex={isCurrent ? 0 : -1}
            title={item.checkpoint?.createdAt ?? undefined}
            type="button"
          >
            <span
              aria-hidden="true"
              className={cx('h-1.5 w-1.5 shrink-0 rounded-full', isCurrent ? 'bg-text-button' : 'bg-text-tertiary')}
            />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {checkpointTime ? (
              <time className="shrink-0 text-[10px] tabular-nums opacity-60" dateTime={item.checkpoint?.createdAt}>
                {checkpointTime}
              </time>
            ) : null}
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
  const editDocumentV2 = useEditorStore((state) => state.editDocumentV2);
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const imageSession = useEditorStore((state) => state.imageSession);
  const imageSessionId = useEditorStore((state) => state.imageSessionId);
  const createSnapshot = useEditorStore((state) => state.createNamedSnapshot);
  const renameSnapshot = useEditorStore((state) => state.renameNamedSnapshot);
  const deleteSnapshot = useEditorStore((state) => state.deleteNamedSnapshot);
  const restoreSnapshot = useEditorStore((state) => state.restoreNamedSnapshot);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sourceSessionId = selectedImagePath
    ? `editor-image-source:${selectedImagePath}`
    : (imageSession?.id ?? `editor-image-session:${String(imageSessionId)}`);
  const snapshots = useMemo(
    () => readNamedSnapshots(editDocumentV2, selectedImagePath, sourceSessionId),
    [editDocumentV2, selectedImagePath, sourceSessionId],
  );
  const activeSnapshotId =
    snapshots.find((snapshot) => snapshotDocumentEquals(snapshot.editDocumentV2, editDocumentV2))?.id ?? null;

  useEffect(() => {
    if (editingId !== null) inputRef.current?.focus();
  }, [editingId]);

  if (selectedImagePath === null) return <LegacySnapshotsSection />;

  const beginRename = (snapshot: EditorNamedSnapshot) => {
    setEditingId(snapshot.id);
    setEditingLabel(snapshot.label);
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
    if (!renameSnapshot(id, editingLabel)) return;
    setEditingId(null);
    setEditingLabel('');
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-snapshot-rename="${id}"]`)?.focus());
  };

  return (
    <div className="py-1" data-testid="editor-sidebar-snapshots-content">
      <button
        className={cx(rowClassName, 'border-b border-editor-border hover:bg-editor-selected-quiet')}
        data-testid="editor-sidebar-snapshot-create"
        disabled={selectedImagePath === null}
        onClick={() => {
          createSnapshot(`Snapshot ${String(snapshots.length + 1)}`);
        }}
        type="button"
      >
        <BookmarkPlus aria-hidden="true" className="shrink-0 text-text-secondary" size={14} />
        {/* i18next-instrument-ignore */}
        <span className="min-w-0 flex-1 truncate">Create snapshot</span>
      </button>

      {snapshots.length === 0 ? (
        /* i18next-instrument-ignore */
        <p className="px-3 py-4 text-xs text-text-secondary" data-testid="editor-sidebar-snapshots-empty">
          No named snapshots.
        </p>
      ) : (
        /* i18next-instrument-ignore */
        <div aria-label="Session snapshots" className="max-h-56 overflow-y-auto" role="listbox">
          {snapshots.map((snapshot) => {
            const isCurrent = snapshot.id === activeSnapshotId;
            const isEditing = snapshot.id === editingId;
            return (
              <div
                className={cx(
                  'flex min-h-9 items-center gap-1 px-2',
                  isCurrent ? 'bg-editor-primary-active text-text-button' : 'hover:bg-editor-selected-quiet',
                )}
                data-testid={isCurrent ? 'editor-sidebar-snapshot-active-row' : 'editor-sidebar-snapshot-row'}
                key={snapshot.id}
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
                    onClick={() => restoreSnapshot(snapshot.id)}
                    role="option"
                    type="button"
                  >
                    {snapshot.label}
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
                    aria-label={`Rename ${snapshot.label}`}
                    className={cx(
                      editorChromeTokens.button.base,
                      editorChromeTokens.button.iconCompact,
                      editorChromeTokens.button.quiet,
                    )}
                    data-snapshot-rename={snapshot.id}
                    onClick={() => beginRename(snapshot)}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={13} />
                  </button>
                )}
                {!isEditing ? (
                  <button
                    aria-label={`Delete ${snapshot.label}`}
                    className={cx(
                      editorChromeTokens.button.base,
                      editorChromeTokens.button.iconCompact,
                      editorChromeTokens.button.quiet,
                    )}
                    data-testid="editor-sidebar-snapshot-delete"
                    onClick={() => deleteSnapshot(snapshot.id)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={13} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Compatibility surface for the history-only session used before an image is opened. */
function LegacySnapshotsSection() {
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
    (item): item is typeof item & { checkpoint: NonNullable<typeof item.checkpoint> } => item.checkpoint !== null,
  );
  const activeItem = items[historyIndex] ?? null;

  useEffect(() => {
    if (editingId !== null) inputRef.current?.focus();
  }, [editingId]);

  return (
    <div className="py-1" data-editor-snapshot-legacy="true" data-testid="editor-sidebar-snapshots-content">
      <button
        className={cx(rowClassName, 'border-b border-editor-border hover:bg-editor-selected-quiet')}
        data-testid="editor-sidebar-snapshot-create"
        disabled={activeItem === null}
        onClick={() => {
          if (activeItem) createCheckpoint(activeItem.label);
        }}
        type="button"
      >
        <BookmarkPlus aria-hidden="true" className="shrink-0 text-text-secondary" size={14} />
        {/* i18next-instrument-ignore */}
        <span className="min-w-0 flex-1 truncate">Create session snapshot</span>
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
                      if (event.key === 'Enter' && editingLabel.trim()) {
                        renameCheckpoint(item.checkpoint.id, editingLabel);
                        setEditingId(null);
                      }
                    }}
                    ref={inputRef}
                    value={editingLabel}
                  />
                ) : (
                  <button
                    aria-selected={isCurrent}
                    className="min-w-0 flex-1 truncate py-2 text-left text-xs"
                    onClick={() => goToHistoryIndex(item.historyIndex)}
                    role="option"
                    type="button"
                  >
                    {item.checkpoint.label}
                  </button>
                )}
                {!isEditing ? (
                  <button
                    aria-label={`Rename ${item.checkpoint.label}`}
                    className={cx(
                      editorChromeTokens.button.base,
                      editorChromeTokens.button.iconCompact,
                      editorChromeTokens.button.quiet,
                    )}
                    data-snapshot-rename={item.checkpoint.id}
                    onClick={() => {
                      setEditingId(item.checkpoint.id);
                      setEditingLabel(item.checkpoint.label);
                    }}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={13} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
