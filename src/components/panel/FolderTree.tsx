import cx from 'clsx';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  Folder,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Search,
  X,
  Album as AlbumIcon,
  Plus,
  Plane,
  Mountain,
  Sun,
  Camera,
  Map,
  Heart,
  Star,
  Users,
  User,
  Car,
  Briefcase,
  ArrowUpDown,
  Check,
  type LucideIcon,
} from 'lucide-react';
import {
  useState,
  useMemo,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { albumTreeSchema } from '../../schemas/albumSchemas';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { TEXT_COLOR_KEYS, TextColors, TextVariants, TextWeights } from '../../types/typography';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';
import { type AlbumItem, type FolderTreeSort, Invokes, SortDirection } from '../ui/AppProperties';
import UiText from '../ui/Text';

export interface FolderTree {
  children: FolderTree[];
  isDir: boolean;
  name: string;
  path: string;
  imageCount?: number | undefined;
  hasSubdirs?: boolean | undefined;
  modified?: number | undefined;
  created?: number | undefined;
}

interface FolderTreeProps {
  isResizing: boolean;
  isVisible: boolean;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, path: string | null, isPinned?: boolean) => void;
  onAlbumContextMenu: (event: ReactMouseEvent<HTMLElement>, item: AlbumItem | null) => void;
  onFolderSelect: (folder: string) => void;
  onSelectAlbum: (albumId: string, albumName: string, images: string[]) => void;
  onToggleFolder: (folder: string) => void;
  onOpenFolder: () => void;
  setIsVisible: (visible: boolean) => void;
  style: CSSProperties;
  isInstantTransition: boolean;
}

interface TreeNodeProps {
  expandedFolders: Set<string>;
  isExpanded: boolean;
  node: FolderTree;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, path: string, isPinned?: boolean) => void;
  onFolderSelect: (folder: string) => void;
  onToggle: (path: string) => void;
  selectedPath: string | null;
  pinnedFolders: string[];
  showImageCounts: boolean;
  isInstantTransition: boolean;
  folderIcons: Record<string, string>;
}

interface VisibleProps {
  index: number;
  total: number;
}

const ALBUM_ICONS: Record<string, LucideIcon> = {
  plane: Plane,
  mountain: Mountain,
  sun: Sun,
  camera: Camera,
  map: Map,
  heart: Heart,
  star: Star,
  users: Users,
  user: User,
  car: Car,
  briefcase: Briefcase,
};

const filterTree = (node: FolderTree | null, query: string): FolderTree | null => {
  if (!node) {
    return null;
  }

  const lowerCaseQuery = query.toLowerCase();
  const isMatch = node.name.toLowerCase().includes(lowerCaseQuery);

  if (node.children.length === 0) {
    return isMatch ? node : null;
  }

  const filteredChildren = node.children
    .map((child: FolderTree) => filterTree(child, query))
    .filter((child: FolderTree | null): child is FolderTree => child !== null);

  if (isMatch || filteredChildren.length > 0) {
    return { ...node, children: filteredChildren };
  }

  return null;
};

const getAutoExpandedPaths = (node: FolderTree, paths: Set<string>) => {
  if (node.children.length > 0) {
    paths.add(node.path);
    node.children.forEach((child: FolderTree) => {
      getAutoExpandedPaths(child, paths);
    });
  }
};

const filterAlbumTree = (node: AlbumItem | null, query: string): AlbumItem | null => {
  if (!node) return null;

  const lowerCaseQuery = query.toLowerCase();
  const isMatch = node.name.toLowerCase().includes(lowerCaseQuery);

  if (node.type === 'album') {
    return isMatch ? node : null;
  }

  const filteredChildren = node.children
    .map((child) => filterAlbumTree(child, query))
    .filter((child): child is AlbumItem => child !== null);

  if (isMatch || filteredChildren.length > 0) {
    return { ...node, children: filteredChildren };
  }

  return null;
};

const getAutoExpandedAlbumGroups = (node: AlbumItem, groups: Set<string>) => {
  if (node.type === 'group' && node.children.length > 0) {
    groups.add(node.id);
    node.children.forEach((child) => {
      getAutoExpandedAlbumGroups(child, groups);
    });
  }
};

const sortFolderTree = (nodes: FolderTree[], sort: FolderTreeSort): FolderTree[] => {
  const sorted = [...nodes].sort((a, b) => {
    const comparison =
      sort.key === 'name'
        ? a.name.localeCompare(b.name)
        : sort.key === 'modified'
          ? (a.modified || 0) - (b.modified || 0)
          : sort.key === 'created'
            ? (a.created || 0) - (b.created || 0)
            : (a.imageCount || 0) - (b.imageCount || 0);
    return sort.order === SortDirection.Ascending ? comparison : -comparison;
  });

  return sorted.map((node) => ({
    ...node,
    children: node.children.length > 0 ? sortFolderTree(node.children, sort) : node.children,
  }));
};

const getAlbumImageCount = (item: AlbumItem): number => {
  if (item.type === 'album') {
    return item.images.length;
  }

  return item.children.reduce((sum, child) => sum + getAlbumImageCount(child), 0);
};

function SectionHeader({ title, isOpen, onToggle }: { title: string; isOpen: boolean; onToggle: () => void }) {
  const { t } = useTranslation();

  return (
    <UiText
      as="div"
      variant={TextVariants.small}
      weight={TextWeights.bold}
      className="flex items-center w-full px-1 py-1.5 cursor-pointer group"
      onClick={onToggle}
      data-tooltip={
        isOpen
          ? t('library.folders.collapseSection', { section: title })
          : t('library.folders.expandSection', { section: title })
      }
    >
      <div className="p-0.5 rounded-md transition-colors">
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>
      <span className="ml-1 uppercase tracking-wider select-none">{title}</span>
    </UiText>
  );
}

function FolderSortMenu({
  sort,
  onChange,
  isOpen,
  setIsOpen,
}: {
  sort: FolderTreeSort;
  onChange: (sort: FolderTreeSort) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [setIsOpen]);

  const options = [
    { key: 'name', label: t('library.folders.sort.name') },
    { key: 'created', label: t('library.folders.sort.created') },
    { key: 'modified', label: t('library.folders.sort.modified') },
    { key: 'imageCount', label: t('library.folders.sort.imageCount') },
  ] as const;

  return (
    <div className="relative" ref={menuRef}>
      <button
        className={cx(
          'bg-surface rounded-md hover:bg-card-active flex items-center justify-center shrink-0 overflow-hidden transition-colors w-9 h-9',
          isOpen && 'bg-card-active',
        )}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        data-tooltip={t('library.folders.tooltips.sortFolders')}
      >
        <ArrowUpDown size={16} className="text-text-secondary" />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1, ease: 'easeOut' }}
            className="absolute right-0 top-full mt-2 w-48 origin-top-right z-50"
          >
            <div className="bg-surface/90 backdrop-blur-md border border-border-color/50 rounded-lg shadow-xl p-2 flex flex-col">
              <div className="px-3 py-2 relative flex items-center">
                <UiText as="div" variant={TextVariants.small} weight={TextWeights.semibold} className="uppercase">
                  {t('library.header.viewOptions.sortBy')}
                </UiText>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange({
                      ...sort,
                      order:
                        sort.order === SortDirection.Ascending ? SortDirection.Descending : SortDirection.Ascending,
                    });
                  }}
                  data-tooltip={
                    sort.order === SortDirection.Ascending
                      ? t('library.header.viewOptions.sortDescending')
                      : t('library.header.viewOptions.sortAscending')
                  }
                  className="absolute top-1/2 right-3 -translate-y-1/2 p-1 bg-transparent border-none text-text-secondary hover:text-text-primary rounded-sm transition-colors"
                >
                  {sort.order === SortDirection.Ascending ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>

              {options.map((option) => {
                const isSelected = sort.key === option.key;
                return (
                  <button
                    key={option.key}
                    className={cx(
                      'w-full text-left px-3 py-2 rounded-md flex items-center justify-between transition-colors duration-150',
                      isSelected ? 'bg-card-active' : 'hover:bg-bg-primary',
                    )}
                    onClick={() => {
                      if (sort.key !== option.key) {
                        onChange({ key: option.key, order: sort.order });
                      }
                      setIsOpen(false);
                    }}
                  >
                    <UiText
                      variant={TextVariants.label}
                      color={TextColors.primary}
                      weight={isSelected ? TextWeights.semibold : TextWeights.normal}
                    >
                      {option.label}
                    </UiText>
                    {isSelected && <Check size={16} className={TEXT_COLOR_KEYS[TextColors.primary]} />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AlbumTreeNode({
  item,
  expandedGroups,
  onToggle,
  onSelectAlbum,
  onContextMenu,
  selectedAlbumId,
  showImageCounts,
}: {
  item: AlbumItem;
  expandedGroups: Set<string>;
  onToggle: (id: string) => void;
  onSelectAlbum: (id: string, name: string, images: string[]) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, item: AlbumItem) => void;
  selectedAlbumId: string | null;
  showImageCounts: boolean;
}) {
  const isGroup = item.type === 'group';
  const isExpanded = expandedGroups.has(item.id);
  const isSelected = item.id === selectedAlbumId;
  const imageCount = getAlbumImageCount(item);
  const handleSelect = () => {
    if (isGroup) {
      onToggle(item.id);
    } else {
      onSelectAlbum(item.id, item.name, item.images);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleSelect();
  };

  let ItemIcon = isGroup ? (isExpanded ? FolderOpen : Folder) : AlbumIcon;
  const customIcon = item.icon ? ALBUM_ICONS[item.icon] : undefined;
  if (customIcon) {
    ItemIcon = customIcon;
  }
  const iconKey = item.icon || (isGroup ? (isExpanded ? 'group-open' : 'group-closed') : 'album');

  return (
    <UiText as="div" color={TextColors.primary} weight={TextWeights.medium}>
      <div
        className={cx('flex items-center gap-2 p-1.5 rounded-md transition-colors cursor-pointer', {
          'bg-surface': isSelected,
          'hover:bg-card-active': !isSelected,
        })}
        onClick={handleSelect}
        onContextMenu={(e) => {
          onContextMenu(e, item);
        }}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        <div className="relative w-5 h-5 flex items-center justify-center p-0.5 rounded-sm text-text-secondary shrink-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={iconKey}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              <ItemIcon size={16} />
            </motion.div>
          </AnimatePresence>
        </div>
        <span
          onDoubleClick={() => {
            if (isGroup) {
              onToggle(item.id);
            }
          }}
          className="truncate flex-1 select-none"
        >
          {item.name}
          {imageCount > 0 && (
            <UiText
              as="span"
              variant={TextVariants.small}
              color={TextColors.secondary}
              className={cx(
                'inline-block ml-1 transition-all ease-in-out duration-300',
                showImageCounts ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2',
              )}
            >
              ({imageCount})
            </UiText>
          )}
        </span>
        {isGroup && (
          <button
            type="button"
            className="text-text-secondary p-0.5 rounded-sm hover:bg-surface/50 bg-transparent"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(item.id);
            }}
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>

      <AnimatePresence>
        {isGroup && isExpanded && item.children.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="pl-1 border-l-[1.5px] border-border-color/50 ml-3.75 overflow-hidden"
          >
            <div className="py-1">
              <AnimatePresence>
                {item.children.map((child) => (
                  <motion.div
                    key={child.id}
                    initial={{ opacity: 0, height: 0, x: -10 }}
                    animate={{ opacity: 1, height: 'auto', x: 0 }}
                    exit={{ opacity: 0, height: 0, x: -10, overflow: 'hidden' }}
                    transition={{ duration: 0.2 }}
                  >
                    <AlbumTreeNode
                      item={child}
                      expandedGroups={expandedGroups}
                      onToggle={onToggle}
                      onSelectAlbum={onSelectAlbum}
                      onContextMenu={onContextMenu}
                      selectedAlbumId={selectedAlbumId}
                      showImageCounts={showImageCounts}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </UiText>
  );
}

function TreeNode({
  expandedFolders,
  isExpanded,
  node,
  onContextMenu,
  onFolderSelect,
  onToggle,
  selectedPath,
  pinnedFolders,
  showImageCounts,
  isInstantTransition,
  folderIcons,
}: TreeNodeProps) {
  const { t } = useTranslation();
  const hasChildren = node.hasSubdirs || node.children.length > 0;
  const isSelected = node.path === selectedPath;
  const isPinned = pinnedFolders.includes(node.path);

  const handleFolderIconClick = (e: ReactMouseEvent<HTMLElement>) => {
    e.stopPropagation();
    if (hasChildren) {
      onToggle(node.path);
    }
  };

  const handleNameClick = () => {
    onFolderSelect(node.path);
  };
  const handleNameKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleNameClick();
  };

  const handleNameDoubleClick = () => {
    if (hasChildren) {
      onToggle(node.path);
    }
  };
  const disclosureLabel = isExpanded
    ? t('library.items.collapseFolderNamed', { name: node.name })
    : t('library.items.expandFolderNamed', { name: node.name });

  const containerVariants: Variants = {
    closed: { height: 0, opacity: 0, transition: { duration: 0.2, ease: 'easeInOut' } },
    open: { height: 'auto', opacity: 1, transition: { duration: 0.25, ease: 'easeInOut' } },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -15 },
    visible: ({ index, total }: VisibleProps) => ({
      opacity: 1,
      x: 0,
      transition: {
        duration: 0.25,
        delay: total < 8 ? index * 0.05 : 0,
      },
    }),
    exit: { opacity: 0, x: -15, transition: { duration: 0.2 } },
  };

  const currentFolderIconKey = folderIcons[node.path];
  let ResolvedIcon = isExpanded ? FolderOpen : Folder;
  if (currentFolderIconKey && ALBUM_ICONS[currentFolderIconKey]) {
    ResolvedIcon = ALBUM_ICONS[currentFolderIconKey];
  }
  const iconKey = currentFolderIconKey || (isExpanded ? 'folder-open' : 'folder-closed');

  return (
    <UiText as="div" color={TextColors.primary} weight={TextWeights.medium}>
      <div
        className={cx('flex items-center gap-2 p-1.5 rounded-md transition-colors cursor-pointer', {
          'bg-surface': isSelected,
          'hover:bg-card-active': !isSelected,
        })}
        onClick={handleNameClick}
        onContextMenu={(e) => {
          onContextMenu(e, node.path, isPinned);
        }}
        onKeyDown={handleNameKeyDown}
        aria-label={t('library.items.selectFolderNamed', { name: node.name })}
        role="button"
        tabIndex={0}
      >
        <button
          type="button"
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-label={disclosureLabel}
          className={cx(
            'relative w-5 h-5 flex items-center justify-center p-0.5 rounded-sm transition-colors shrink-0 bg-transparent',
            {
              [TEXT_COLOR_KEYS[TextColors.secondary]]: !isExpanded,
              'hover:bg-surface-hover': !isSelected && hasChildren,
            },
          )}
          onClick={handleFolderIconClick}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={iconKey}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              <ResolvedIcon size={16} />
            </motion.div>
          </AnimatePresence>
        </button>

        <span onDoubleClick={handleNameDoubleClick} className="truncate select-none flex-1">
          <span className="truncate">{node.name}</span>
          {typeof node.imageCount === 'number' && node.imageCount > 0 && (
            <UiText
              as="span"
              variant={TextVariants.small}
              color={TextColors.secondary}
              className={cx(
                'inline-block ml-1 transition-all ease-in-out duration-300',
                showImageCounts ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2',
              )}
            >
              ({node.imageCount})
            </UiText>
          )}
        </span>

        {hasChildren && (
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-label={disclosureLabel}
            className={cx('p-0.5 rounded-sm hover:bg-surface/50 bg-transparent', TEXT_COLOR_KEYS[TextColors.secondary])}
            onClick={handleFolderIconClick}
          >
            {isExpanded ? <ChevronUp size={16} className="shrink-0" /> : <ChevronDown size={16} className="shrink-0" />}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {hasChildren && isExpanded && node.children.length > 0 && (
          <motion.div
            animate="open"
            className="pl-1 border-l-[1.5px] border-border-color/50 ml-3.75 overflow-hidden"
            exit="closed"
            initial={isInstantTransition ? 'open' : 'closed'}
            key="children-container"
            variants={containerVariants}
          >
            <div className="py-1">
              <AnimatePresence>
                {node.children.map((childNode, index) => (
                  <motion.div
                    animate="visible"
                    custom={{ index, total: node.children.length }}
                    exit="exit"
                    initial={isInstantTransition ? 'visible' : 'hidden'}
                    key={childNode.path}
                    layout={isInstantTransition ? false : 'position'}
                    variants={itemVariants}
                  >
                    <TreeNode
                      expandedFolders={expandedFolders}
                      isExpanded={expandedFolders.has(childNode.path)}
                      node={childNode}
                      onContextMenu={onContextMenu}
                      onFolderSelect={onFolderSelect}
                      onToggle={onToggle}
                      selectedPath={selectedPath}
                      pinnedFolders={pinnedFolders}
                      showImageCounts={showImageCounts}
                      isInstantTransition={isInstantTransition}
                      folderIcons={folderIcons}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </UiText>
  );
}

export default function FolderTree({
  isResizing,
  isVisible,
  onContextMenu,
  onAlbumContextMenu,
  onFolderSelect,
  onSelectAlbum,
  onToggleFolder,
  onOpenFolder,
  setIsVisible,
  style,
  isInstantTransition,
}: FolderTreeProps) {
  const { t } = useTranslation();
  const { appSettings, handleSettingsChange } = useSettingsStore();
  const {
    folderTrees,
    pinnedFolderTrees,
    currentFolderPath: selectedPath,
    expandedFolders,
    isTreeLoading: isLoading,
    albumTree,
    activeAlbumId,
    expandedAlbumGroups,
  } = useLibraryStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isHovering, setIsHovering] = useState(false);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const pinnedFolders = appSettings?.pinnedFolders || [];
  const openSections = useMemo(() => appSettings?.openTreeSections ?? ['current'], [appSettings?.openTreeSections]);
  const showImageCounts = appSettings?.enableFolderImageCounts ?? false;
  const folderIcons = appSettings?.folderIcons || {};
  const folderTreeSort = useMemo<FolderTreeSort>(
    () => appSettings?.folderTreeSort ?? { key: 'name', order: SortDirection.Ascending },
    [appSettings?.folderTreeSort],
  );
  const showHeaderButtons = isHovering || isSortMenuOpen;

  useEffect(() => {
    void invokeWithSchema(Invokes.GetAlbums, {}, albumTreeSchema)
      .then((res) => {
        useLibraryStore.getState().setLibrary({ albumTree: res });
      })
      .catch((err: unknown) => {
        console.error('Failed to load albums:', err);
      });
  }, []);

  const toggleSection = (section: string) => {
    if (appSettings) {
      const isOpen = openSections.includes(section);
      const newSections = isOpen ? openSections.filter((s) => s !== section) : [...openSections, section];

      void handleSettingsChange({ ...appSettings, openTreeSections: newSections });
    }
  };

  const handleEmptyAreaContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onContextMenu(e, null, false);
    }
  };

  const toggleAlbumGroup = (id: string) => {
    useLibraryStore.getState().setLibrary((state) => {
      const next = new Set(state.expandedAlbumGroups);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedAlbumGroups: next };
    });
  };

  const trimmedQuery = searchQuery.trim();
  const isSearching = trimmedQuery.length > 1;

  const filteredTrees = useMemo(() => {
    const base = isSearching
      ? folderTrees.map((tree) => filterTree(tree, trimmedQuery)).filter((tree): tree is FolderTree => tree !== null)
      : folderTrees;
    return sortFolderTree(base, folderTreeSort);
  }, [folderTrees, trimmedQuery, isSearching, folderTreeSort]);

  const filteredPinnedTrees = useMemo(() => {
    const base = isSearching
      ? pinnedFolderTrees
          .map((pinnedTree) => filterTree(pinnedTree, trimmedQuery))
          .filter((tree): tree is FolderTree => tree !== null)
      : pinnedFolderTrees;
    return sortFolderTree(base, folderTreeSort);
  }, [pinnedFolderTrees, trimmedQuery, isSearching, folderTreeSort]);

  const searchAutoExpandedFolders = useMemo(() => {
    if (!isSearching) return new Set<string>();
    const newExpanded = new Set<string>();
    filteredTrees.forEach((tree) => {
      getAutoExpandedPaths(tree, newExpanded);
    });
    filteredPinnedTrees.forEach((pinned) => {
      getAutoExpandedPaths(pinned, newExpanded);
    });
    return newExpanded;
  }, [isSearching, filteredTrees, filteredPinnedTrees]);

  const effectiveExpandedFolders = useMemo(() => {
    return new Set([...expandedFolders, ...searchAutoExpandedFolders]);
  }, [expandedFolders, searchAutoExpandedFolders]);

  const filteredAlbumTree = useMemo(() => {
    if (!isSearching) return albumTree;
    return albumTree
      .map((item) => filterAlbumTree(item, trimmedQuery))
      .filter((item): item is AlbumItem => item !== null);
  }, [albumTree, trimmedQuery, isSearching]);

  const searchAutoExpandedAlbumGroups = useMemo(() => {
    if (!isSearching) return new Set<string>();
    const next = new Set<string>();
    filteredAlbumTree.forEach((item) => {
      getAutoExpandedAlbumGroups(item, next);
    });
    return next;
  }, [isSearching, filteredAlbumTree]);

  const effectiveExpandedAlbumGroups = useMemo(() => {
    return new Set([...expandedAlbumGroups, ...searchAutoExpandedAlbumGroups]);
  }, [expandedAlbumGroups, searchAutoExpandedAlbumGroups]);

  useEffect(() => {
    if (isSearching && appSettings) {
      const hasPinnedResults = filteredPinnedTrees.length > 0;
      const hasBaseResults = filteredTrees.length > 0;
      const hasAlbumResults = filteredAlbumTree.length > 0;

      const newSections = [...openSections];
      let changed = false;

      if (hasPinnedResults && !newSections.includes('pinned')) {
        newSections.push('pinned');
        changed = true;
      }
      if (hasBaseResults && !newSections.includes('current')) {
        newSections.push('current');
        changed = true;
      }
      if (hasAlbumResults && !newSections.includes('albums')) {
        newSections.push('albums');
        changed = true;
      }

      if (changed) {
        void handleSettingsChange({ ...appSettings, openTreeSections: newSections });
      }
    }
  }, [
    isSearching,
    filteredTrees,
    filteredPinnedTrees,
    filteredAlbumTree,
    openSections,
    handleSettingsChange,
    appSettings,
  ]);

  const isPinnedOpen = openSections.includes('pinned');
  const isCurrentOpen = openSections.includes('current');
  const isAlbumsOpen = openSections.includes('albums');

  const hasVisiblePinnedTrees = filteredPinnedTrees.length > 0;
  const hasVisibleAlbums = filteredAlbumTree.length > 0;
  const showAlbumsSection = hasVisibleAlbums || (!isSearching && albumTree.length === 0);

  return (
    <div
      className={cx(
        'relative bg-bg-secondary rounded-lg shrink-0',
        !isResizing && 'transition-[width] duration-300 ease-in-out',
      )}
      style={style}
      onMouseEnter={() => {
        setIsHovering(true);
      }}
      onMouseLeave={() => {
        setIsHovering(false);
      }}
    >
      {!isVisible && (
        <button
          className="absolute top-1/2 -translate-y-1/2 right-1 w-6 h-10 hover:bg-card-active rounded-md flex items-center justify-center z-30"
          onClick={() => {
            setIsVisible(true);
          }}
          data-tooltip={t('library.folders.tooltips.expand')}
        >
          <ChevronRight size={16} />
        </button>
      )}

      {isVisible && (
        <div className="p-2 flex flex-col h-full">
          <div className="pt-1 pb-2">
            <div className="flex items-center">
              <AnimatePresence>
                {showHeaderButtons && (
                  <motion.button
                    initial={{ width: 0, padding: 0, marginRight: 0, opacity: 0 }}
                    animate={{ width: 36, padding: 10, marginRight: 6, opacity: 1 }}
                    exit={{ width: 0, padding: 0, marginRight: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="bg-surface rounded-md hover:bg-card-active flex items-center justify-center shrink-0 overflow-hidden transition-colors"
                    onClick={() => {
                      setIsVisible(false);
                    }}
                    data-tooltip={t('library.folders.tooltips.collapse')}
                  >
                    <ChevronLeft size={17.5} className="text-text-secondary shrink-0" />
                  </motion.button>
                )}
              </AnimatePresence>
              <div className="relative flex-1 min-w-0">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  placeholder={t('library.folders.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                  }}
                  className="w-full bg-surface border border-transparent rounded-md pl-9 pr-8 py-2 text-sm focus:outline-hidden"
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-card-active"
                    data-tooltip={t('library.folders.tooltips.clearSearch')}
                  >
                    <X size={16} className="text-text-secondary" />
                  </button>
                )}
              </div>
              <AnimatePresence>
                {showHeaderButtons && (
                  <motion.div
                    initial={{ width: 0, opacity: 0, marginLeft: 0 }}
                    animate={{ width: 'auto', opacity: 1, marginLeft: 4 }}
                    exit={{ width: 0, opacity: 0, marginLeft: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className={cx(
                      'flex items-center shrink-0',
                      isSortMenuOpen ? 'overflow-visible' : 'overflow-hidden',
                    )}
                  >
                    <FolderSortMenu
                      sort={folderTreeSort}
                      onChange={(newSort) => {
                        if (appSettings) {
                          void handleSettingsChange({ ...appSettings, folderTreeSort: newSort });
                        }
                      }}
                      isOpen={isSortMenuOpen}
                      setIsOpen={setIsSortMenuOpen}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto" onContextMenu={handleEmptyAreaContextMenu}>
            {hasVisiblePinnedTrees && (
              <>
                <div>
                  <SectionHeader
                    title={t('library.folders.sections.pinned')}
                    isOpen={isPinnedOpen}
                    onToggle={() => {
                      toggleSection('pinned');
                    }}
                  />
                </div>
                <AnimatePresence initial={false}>
                  {isPinnedOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="pt-1 pb-2">
                        <AnimatePresence>
                          {filteredPinnedTrees.map((pinnedTree, index) => (
                            <motion.div
                              key={pinnedTree.path}
                              animate="visible"
                              custom={{ index, total: filteredPinnedTrees.length }}
                              exit="exit"
                              initial={isInstantTransition ? 'visible' : 'hidden'}
                              layout={isInstantTransition ? false : 'position'}
                              variants={{
                                hidden: { opacity: 0, x: -15 },
                                visible: ({ index, total }: VisibleProps) => ({
                                  opacity: 1,
                                  x: 0,
                                  transition: { duration: 0.25, delay: total < 8 ? index * 0.05 : 0 },
                                }),
                                exit: { opacity: 0, x: -15, transition: { duration: 0.2 } },
                              }}
                            >
                              <TreeNode
                                expandedFolders={effectiveExpandedFolders}
                                isExpanded={effectiveExpandedFolders.has(pinnedTree.path)}
                                node={pinnedTree}
                                onContextMenu={onContextMenu}
                                onFolderSelect={onFolderSelect}
                                onToggle={onToggleFolder}
                                selectedPath={selectedPath}
                                pinnedFolders={pinnedFolders}
                                showImageCounts={showImageCounts && isHovering}
                                isInstantTransition={isInstantTransition}
                                folderIcons={folderIcons}
                              />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {showAlbumsSection && (
              <>
                <div>
                  <SectionHeader
                    title={t('library.folders.sections.albums')}
                    isOpen={isAlbumsOpen}
                    onToggle={() => {
                      toggleSection('albums');
                    }}
                  />
                </div>
                <AnimatePresence>
                  {isAlbumsOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onAlbumContextMenu(e, null);
                      }}
                    >
                      <div className="pt-1 pb-2">
                        <AnimatePresence>
                          {filteredAlbumTree.map((item) => (
                            <motion.div
                              key={item.id}
                              initial={{ opacity: 0, height: 0, x: -15 }}
                              animate={{ opacity: 1, height: 'auto', x: 0 }}
                              exit={{ opacity: 0, height: 0, x: -15, overflow: 'hidden' }}
                              transition={{ duration: 0.2 }}
                              layout="position"
                            >
                              <AlbumTreeNode
                                item={item}
                                expandedGroups={effectiveExpandedAlbumGroups}
                                onToggle={toggleAlbumGroup}
                                onSelectAlbum={onSelectAlbum}
                                onContextMenu={onAlbumContextMenu}
                                selectedAlbumId={activeAlbumId}
                                showImageCounts={showImageCounts && isHovering}
                              />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                        {albumTree.length === 0 && !isSearching && (
                          <motion.div layout="position">
                            <UiText variant={TextVariants.small} className="p-2 text-center">
                              {t('library.folders.albumsEmpty')}
                            </UiText>
                          </motion.div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {filteredTrees.length > 0 && (
              <>
                <div>
                  <SectionHeader
                    title={t('library.folders.sections.folders')}
                    isOpen={isCurrentOpen}
                    onToggle={() => {
                      toggleSection('current');
                    }}
                  />
                </div>
                <AnimatePresence initial={false}>
                  {isCurrentOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="pt-1">
                        <AnimatePresence>
                          {filteredTrees.map((tree, index) => (
                            <motion.div
                              key={tree.path}
                              animate="visible"
                              custom={{ index, total: filteredTrees.length }}
                              exit="exit"
                              initial={isInstantTransition ? 'visible' : 'hidden'}
                              layout={isInstantTransition ? false : 'position'}
                              variants={{
                                hidden: { opacity: 0, x: -15 },
                                visible: ({ index, total }: VisibleProps) => ({
                                  opacity: 1,
                                  x: 0,
                                  transition: { duration: 0.25, delay: total < 8 ? index * 0.05 : 0 },
                                }),
                                exit: { opacity: 0, x: -15, transition: { duration: 0.2 } },
                              }}
                            >
                              <TreeNode
                                expandedFolders={effectiveExpandedFolders}
                                isExpanded={effectiveExpandedFolders.has(tree.path)}
                                node={tree}
                                onContextMenu={onContextMenu}
                                onFolderSelect={onFolderSelect}
                                onToggle={onToggleFolder}
                                selectedPath={selectedPath}
                                pinnedFolders={pinnedFolders}
                                showImageCounts={showImageCounts && isHovering}
                                isInstantTransition={isInstantTransition}
                                folderIcons={folderIcons}
                              />
                            </motion.div>
                          ))}
                        </AnimatePresence>

                        <AnimatePresence initial={false}>
                          {isHovering && !isSearching && (
                            <motion.div
                              layout="position"
                              initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                              animate={{ opacity: 1, height: 'auto', overflow: 'hidden' }}
                              exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                              transition={{ duration: 0.2 }}
                            >
                              <UiText
                                as="div"
                                weight={TextWeights.medium}
                                className="flex items-center gap-2 p-2 mt-1 rounded-md transition-colors transition-opacity opacity-70 hover:opacity-100 hover:bg-card-active cursor-pointer hover:text-text-primary"
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  onOpenFolder();
                                }}
                              >
                                <div className="relative w-4 h-4 ml-1 shrink-0 flex items-center justify-center">
                                  <Plus size={16} />
                                </div>
                                <span className="select-none">{t('library.folders.addFolder')}</span>
                              </UiText>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {filteredTrees.length === 0 && !hasVisiblePinnedTrees && !hasVisibleAlbums && isSearching && (
              <UiText className="p-2 text-center">{t('library.folders.noFoldersFound')}</UiText>
            )}

            {folderTrees.length === 0 && pinnedFolderTrees.length === 0 && !isSearching && (
              <div className="pt-1">
                {isLoading ? (
                  <UiText className="animate-pulse p-2">{t('library.folders.loading')}</UiText>
                ) : (
                  <UiText className="p-2">{t('library.folders.openFolderInstruction')}</UiText>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
