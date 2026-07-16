import cx from 'clsx';
import { Album as AlbumIcon, ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryStore } from '../../../store/useLibraryStore';
import type { AlbumItem } from '../../ui/AppProperties';

interface EditorCollectionsSectionProps {
  onSelectAlbum: (albumId: string, albumName: string, images: string[]) => void;
}

const countAlbumImages = (item: AlbumItem): number =>
  item.type === 'album'
    ? item.images.length
    : item.children.reduce((total, child) => total + countAlbumImages(child), 0);

const toggleGroup = (id: string, expanded: ReadonlySet<string>, setExpanded: (next: Set<string>) => void): void => {
  const next = new Set(expanded);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setExpanded(next);
};

function CollectionItem({
  item,
  expandedGroups,
  onSelectAlbum,
  onToggleGroup,
  activeAlbumId,
}: {
  item: AlbumItem;
  expandedGroups: ReadonlySet<string>;
  onSelectAlbum: EditorCollectionsSectionProps['onSelectAlbum'];
  onToggleGroup: (id: string) => void;
  activeAlbumId: string | null;
}) {
  const isGroup = item.type === 'group';
  const isExpanded = isGroup && expandedGroups.has(item.id);
  const isSelected = !isGroup && item.id === activeAlbumId;
  const handleActivate = () => {
    if (isGroup) onToggleGroup(item.id);
    else onSelectAlbum(item.id, item.name, item.images);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleActivate();
  };
  const Icon = isGroup ? (isExpanded ? FolderOpen : Folder) : AlbumIcon;

  return (
    <div data-editor-collection-item={item.type} data-album-id={item.id}>
      <div
        aria-selected={isSelected}
        className={cx(
          'flex items-center gap-1 rounded-sm px-2 py-1.5 text-sm transition-colors',
          isSelected ? 'bg-surface' : 'hover:bg-card-active',
        )}
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        <Icon aria-hidden="true" className="shrink-0 text-text-secondary" size={15} />
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        <span className="shrink-0 text-xs text-text-secondary" data-album-image-count="true">
          {countAlbumImages(item)}
        </span>
        {isGroup ? (
          <button
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} collection ${item.name}`}
            className="rounded-sm p-0.5 text-text-secondary hover:bg-surface"
            onClick={(event) => {
              event.stopPropagation();
              onToggleGroup(item.id);
            }}
            type="button"
          >
            {isExpanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
          </button>
        ) : null}
      </div>
      {isGroup && isExpanded && item.children.length > 0 ? (
        <div className="ml-3 border-l border-border-color/50 pl-1" data-editor-collection-children="true">
          {item.children.map((child) => (
            <CollectionItem
              activeAlbumId={activeAlbumId}
              expandedGroups={expandedGroups}
              item={child}
              key={child.id}
              onSelectAlbum={onSelectAlbum}
              onToggleGroup={onToggleGroup}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function EditorCollectionsSection({ onSelectAlbum }: EditorCollectionsSectionProps) {
  const { albumTree, activeAlbumId, expandedAlbumGroups, setLibrary } = useLibraryStore(
    useShallow((state) => ({
      albumTree: state.albumTree,
      activeAlbumId: state.activeAlbumId,
      expandedAlbumGroups: state.expandedAlbumGroups,
      setLibrary: state.setLibrary,
    })),
  );
  const setExpandedGroups = (next: Set<string>) => {
    setLibrary({ expandedAlbumGroups: next });
  };

  return (
    // i18next-instrument-ignore
    <div aria-label="Develop collections" className="px-1 pb-2" data-testid="editor-left-collections">
      {albumTree.length === 0 ? (
        // i18next-instrument-ignore
        <p className="px-2 py-3 text-center text-xs text-text-secondary">No Albums Available</p>
      ) : (
        albumTree.map((item) => (
          <CollectionItem
            activeAlbumId={activeAlbumId}
            expandedGroups={expandedAlbumGroups}
            item={item}
            key={item.id}
            onSelectAlbum={onSelectAlbum}
            onToggleGroup={(id) => toggleGroup(id, expandedAlbumGroups, setExpandedGroups)}
          />
        ))
      )}
    </div>
  );
}
