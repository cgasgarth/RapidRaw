import { describe, expect, test } from 'bun:test';

import {
  affectedRustModuleTestCommand,
  selectAffectedRustModules,
} from '../../../scripts/validation/run-affected-rust-module-tests';

describe('affected Rust module precommit selection', () => {
  test('deduplicates staged top-level namespaces and ignores non-module files', () => {
    expect(
      selectAffectedRustModules([
        'src-tauri/src/adjustments/edit_document_v2.rs',
        'src-tauri/src/adjustments/mod.rs',
        'src-tauri/src/io/exif_processing.rs',
        'src-tauri/src/render/film_emulation.rs',
        'src-tauri/src/lib.rs',
        'src-tauri/src/main.rs',
        'src-tauri/Cargo.toml',
        'src/App.tsx',
      ]),
    ).toEqual(['adjustments', 'io', 'render']);
  });

  test('builds one bounded required-ci library suite per namespace', () => {
    expect(affectedRustModuleTestCommand('adjustments')).toEqual([
      'cargo',
      'test',
      '--quiet',
      '--locked',
      '--no-default-features',
      '--features',
      'required-ci',
      '--lib',
      'adjustments::',
    ]);
  });
});
