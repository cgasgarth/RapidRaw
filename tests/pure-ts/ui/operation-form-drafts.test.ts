import { describe, expect, test } from 'bun:test';

import {
  buildOperationFormIdentity,
  buildPathSetIdentity,
  buildRenameFileDraft,
  buildRenameFolderDraft,
  getLocalPathLeaf,
} from '../../../src/utils/operationFormDrafts.ts';

describe('operation form draft initializers', () => {
  test('preserves spaces and Unicode while removing only a single-file extension', () => {
    const path = '/Volumes/Photo Library/Ålesund 旅行/Émulsion scan 01.CR3';
    expect(getLocalPathLeaf(path)).toBe('Émulsion scan 01.CR3');
    expect(buildRenameFileDraft([path])).toBe('Émulsion scan 01');
  });

  test('supports Windows-style Tauri paths without browser path APIs', () => {
    expect(buildRenameFileDraft(['C:\\Photo Library\\scan one.NEF'])).toBe('scan one');
  });

  test('keeps dotfiles and extensionless files intact', () => {
    expect(buildRenameFileDraft(['/library/.negative'])).toBe('.negative');
    expect(buildRenameFileDraft(['/library/scan'])).toBe('scan');
  });

  test('uses the safe original-name token for multi-file operations', () => {
    expect(buildRenameFileDraft(['/a/one.raw', '/b/two.raw'])).toBe('{original_filename}');
  });

  test('builds ordered path-set and reopen identities without lossy joins', () => {
    const sourceIdentity = buildPathSetIdentity(['/a/b|c.raw', '/a/旅行 raw.dng']);
    expect(sourceIdentity).toBe('["/a/b|c.raw","/a/旅行 raw.dng"]');
    expect(buildOperationFormIdentity(sourceIdentity, 4)).toBe(`4:${sourceIdentity}`);
    expect(buildRenameFolderDraft('Ålesund selects')).toBe('Ålesund selects');
  });
});
