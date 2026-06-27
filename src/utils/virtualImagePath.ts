export const VIRTUAL_COPY_SUFFIX = '?vc=';

export interface VirtualImagePathParts {
  path: string;
  virtualCopyId: string | null;
}

export const parseVirtualImagePath = (path: string): VirtualImagePathParts => {
  const parts = path.split(VIRTUAL_COPY_SUFFIX);

  return {
    path: parts[0] ?? path,
    virtualCopyId: parts.length > 1 ? (parts[1] ?? null) : null,
  };
};

export const serializeVirtualImagePath = (path: string, virtualCopyId: string | null | undefined): string => {
  if (virtualCopyId === null || virtualCopyId === undefined) {
    return path;
  }

  return `${path}${VIRTUAL_COPY_SUFFIX}${virtualCopyId}`;
};
