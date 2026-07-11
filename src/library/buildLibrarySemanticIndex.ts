import { type ImageFile, LibraryViewMode } from '../components/ui/AppProperties';
import {
  buildLibraryAutoStacks,
  type LibraryAutoStackDisplay,
  type LibraryAutoStackKind,
} from '../utils/libraryAutoStacks';

export interface LibrarySemanticStack {
  confidence: number;
  count: number;
  coverPath: string;
  id: string;
  kind: LibraryAutoStackKind;
}

export interface LibrarySemanticSourceItem {
  flatStack: LibrarySemanticStack | null;
  imageIndex: number;
  path: string;
  recursiveStack: LibrarySemanticStack | null;
  stack: null;
}

export interface LibrarySemanticFolder {
  itemCount: number;
  memberCount: number;
  memberStart: number;
  path: string;
}

export interface LibrarySemanticIndex {
  folders: readonly LibrarySemanticFolder[];
  folderMemberIndices: Uint32Array;
  images: readonly ImageFile[];
  revision: number;
  sourceItems: readonly LibrarySemanticSourceItem[];
}

export interface LibraryVisibleItem {
  imageIndex: number;
  path: string;
  stack: LibraryAutoStackDisplay | null;
}

export interface LibraryVisibleFolder {
  itemCount: number;
  itemStart: number;
  path: string;
}

export interface LibraryVisibleSemanticIndex {
  folders: readonly LibraryVisibleFolder[];
  items: readonly LibraryVisibleItem[];
  revision: number;
  semantic: LibrarySemanticIndex;
}

let nextSemanticRevision = 1;
let nextVisibleRevision = 1;

const getFolderPath = (path: string): string => {
  const physicalPath = path.split('?vc=')[0] ?? path;
  const separator = physicalPath.includes('/') ? '/' : '\\';
  const lastSeparator = physicalPath.lastIndexOf(separator);
  return lastSeparator >= 0 ? physicalPath.slice(0, lastSeparator) : physicalPath;
};

const detectStacks = (
  images: readonly ImageFile[],
  indices: readonly number[],
  stacksByPath: Map<string, LibrarySemanticStack>,
) => {
  const candidates = indices.map((index) => images[index]).filter((image): image is ImageFile => image !== undefined);
  for (const stack of buildLibraryAutoStacks(candidates)) {
    const semanticStack: LibrarySemanticStack = {
      confidence: stack.confidence,
      count: stack.paths.length,
      coverPath: stack.coverPath,
      id: stack.id,
      kind: stack.kind,
    };
    for (const path of stack.paths) stacksByPath.set(path, semanticStack);
  }
};

export const buildLibrarySemanticIndex = (
  images: readonly ImageFile[],
  baseFolderPath: string | null,
): LibrarySemanticIndex => {
  const membersByFolder = new Map<string, number[]>();
  images.forEach((image, index) => {
    const folderPath = getFolderPath(image.path);
    const members = membersByFolder.get(folderPath);
    if (members) members.push(index);
    else membersByFolder.set(folderPath, [index]);
  });

  const folderPaths = [...membersByFolder.keys()].sort((left, right) => {
    if (left === baseFolderPath) return -1;
    if (right === baseFolderPath) return 1;
    return left.localeCompare(right);
  });
  const memberBuffer = new Uint32Array(images.length);
  const folders: LibrarySemanticFolder[] = [];
  const recursiveStacksByPath = new Map<string, LibrarySemanticStack>();
  const flatStacksByPath = new Map<string, LibrarySemanticStack>();
  detectStacks(
    images,
    images.map((_image, index) => index),
    flatStacksByPath,
  );
  let memberOffset = 0;

  for (const path of folderPaths) {
    const indices = membersByFolder.get(path) ?? [];
    detectStacks(images, indices, recursiveStacksByPath);
    folders.push({ itemCount: indices.length, memberCount: indices.length, memberStart: memberOffset, path });
    memberBuffer.set(indices, memberOffset);
    memberOffset += indices.length;
  }

  return {
    folders,
    folderMemberIndices: memberBuffer,
    images,
    revision: nextSemanticRevision++,
    sourceItems: images.map((image, imageIndex) => ({
      flatStack: flatStacksByPath.get(image.path) ?? null,
      imageIndex,
      path: image.path,
      recursiveStack: recursiveStacksByPath.get(image.path) ?? null,
      stack: null,
    })),
  };
};

const appendVisibleItem = (
  source: LibrarySemanticSourceItem,
  stack: LibrarySemanticStack | null,
  expandedStackIds: ReadonlySet<string>,
  items: LibraryVisibleItem[],
) => {
  if (!stack) {
    items.push(source);
    return;
  }
  const isExpanded = expandedStackIds.has(stack.id);
  const isCover = source.path === stack.coverPath;
  if (!isExpanded && !isCover) return;
  items.push({
    imageIndex: source.imageIndex,
    path: source.path,
    stack: {
      confidence: stack.confidence,
      count: stack.count,
      id: stack.id,
      isCover,
      isExpanded,
      kind: stack.kind,
    },
  });
};

export const buildLibraryVisibleSemanticIndex = (
  semantic: LibrarySemanticIndex,
  expandedStackIds: ReadonlySet<string>,
  viewMode: LibraryViewMode,
): LibraryVisibleSemanticIndex => {
  const items: LibraryVisibleItem[] = [];
  const folders: LibraryVisibleFolder[] = [];
  if (viewMode !== LibraryViewMode.Recursive) {
    for (const source of semantic.sourceItems) appendVisibleItem(source, source.flatStack, expandedStackIds, items);
    return { folders, items, revision: nextVisibleRevision++, semantic };
  }
  for (const folder of semantic.folders) {
    const itemStart = items.length;
    for (let offset = 0; offset < folder.memberCount; offset += 1) {
      const sourceIndex = semantic.folderMemberIndices[folder.memberStart + offset];
      const source = sourceIndex === undefined ? undefined : semantic.sourceItems[sourceIndex];
      if (source) appendVisibleItem(source, source.recursiveStack, expandedStackIds, items);
    }
    folders.push({ itemCount: folder.itemCount, itemStart, path: folder.path });
  }
  return { folders, items, revision: nextVisibleRevision++, semantic };
};
