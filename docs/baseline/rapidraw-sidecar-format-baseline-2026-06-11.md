# RapidRAW Sidecar Format Baseline

- Snapshot date: 2026-06-11
- Issue: #59 `audit(sidecar): document current sidecar format`
- Repository: `cgasgarth/RapidRaw`
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw-doc-sidecar`
- Baseline branch: `codex/docs-sidecar-baseline`
- Baseline commit: `c1e5e91`

## Purpose

This document records the current RapidRAW sidecar and persistence behavior before
RawEngine changes sidecar, catalog, or layer storage. It is a static audit of the
current implementation, not a design proposal.

## Primary Sidecar File

RapidRAW's active sidecar is a pretty-printed JSON file with extension
`.rrdata`.

For a physical image path:

```text
/folder/IMG_0001.CR3
```

the primary sidecar path is:

```text
/folder/IMG_0001.CR3.rrdata
```

The filename includes the full image filename, including the original extension.
This is implemented by appending `.rrdata` to `image_path.file_name()` in
`src-tauri/src/exif_processing.rs:1074` and by `parse_virtual_path` in
`src-tauri/src/library/file_management.rs:165`.

`load_sidecar` returns `ImageMetadata::default()` when the `.rrdata` file is
missing, unreadable, or invalid JSON. If EXIF strings longer than 500 bytes are
found in an otherwise readable sidecar, the loader truncates those values and
writes the healed sidecar back to disk (`src-tauri/src/exif_processing.rs:40`).

## Virtual Copies

Virtual copies are represented as virtual paths, not physical image copies:

```text
/folder/IMG_0001.CR3?vc=abc123
```

The corresponding sidecar is:

```text
/folder/IMG_0001.CR3.abc123.rrdata
```

`create_virtual_copy` generates `abc123` from the first six characters of a UUID
v4 string, then returns the virtual path with `?vc=<id>`
(`src-tauri/src/library/file_management.rs:3374`). Directory scanners reconstruct virtual
copies by looking for `.rrdata` files whose basename ends with a dot plus six
lowercase hexadecimal characters before `.rrdata`
(`src-tauri/src/library/file_management.rs:295` and `src-tauri/src/library/file_management.rs:413`).

When a virtual copy is created, RapidRAW copies the source virtual sidecar if it
exists. If the source sidecar does not exist, it writes a default
`ImageMetadata` JSON document to the new virtual sidecar.

## ImageMetadata Shape

The persisted Rust type is `ImageMetadata` in
`src-tauri/src/render/image_processing.rs:51`:

| Field         | Type                          | Default | Notes                                                                 |
| ------------- | ----------------------------- | ------- | --------------------------------------------------------------------- |
| `version`     | `u32`                         | `1`     | No migration dispatch currently reads this value.                     |
| `rating`      | `u8`                          | `0`     | Stored top-level. Rating commands write this field directly.          |
| `adjustments` | arbitrary `serde_json::Value` | `null`  | Frontend-owned adjustment snapshot. Rust reads known keys as needed.  |
| `tags`        | optional string array         | absent  | Serialized as `null` or omitted depending on writer path and content. |
| `exif`        | optional string map           | absent  | Skipped when `None`; migrated from legacy `.rrexif` when found.       |

A minimal default sidecar currently serializes as:

```json
{
  "version": 1,
  "rating": 0,
  "adjustments": null,
  "tags": null
}
```

When `exif` is present, it is stored as a JSON object whose values are strings.
When `exif` is absent, serde skips it because the field uses
`skip_serializing_if = "Option::is_none"`.

## Adjustments Payload

`adjustments` is not a separately versioned Rust schema. The editor sends the
current frontend adjustment object to `save_metadata_and_update_thumbnail`
(`src/hooks/useEditorActions.ts:25`), and the command replaces
`metadata.adjustments` with that JSON value
(`src-tauri/src/library/file_management.rs:2015`).

Frontend adjustment keys visible in `src/utils/adjustments.ts` include:

- Basic and tone keys such as `exposure`, `brightness`, `contrast`,
  `highlights`, `shadows`, `whites`, `blacks`, `toneMapper`, and `showClipping`.
- Color keys such as `temperature`, `tint`, `saturation`, `vibrance`, `hsl`,
  `colorGrading`, and `colorCalibration`.
- Curves keys such as `curves`, optional `pointCurves`, optional
  `parametricCurve`, and optional `curveMode`.
- Detail/effect keys such as `sharpness`, `sharpnessThreshold`,
  `lumaNoiseReduction`, `colorNoiseReduction`, `clarity`, `structure`,
  `dehaze`, `vignetteAmount`, `grainAmount`, `glowAmount`, `halationAmount`,
  and `flareAmount`.
- Transform and crop keys such as `crop`, `aspectRatio`, `rotation`,
  `flipHorizontal`, `flipVertical`, `orientationSteps`, and `transform*`.
- Lens keys such as `lensCorrectionMode`, `lensMaker`, `lensModel`,
  `lensDistortionParams`, and per-correction enable/amount fields.
- Local editing keys such as `masks` and `aiPatches`.
- LUT keys such as `lutPath`, `lutName`, `lutSize`, `lutIntensity`, and
  optional `lutData`.

Rust rendering code reads known keys and applies defaults for missing values
while converting to GPU adjustment structs
(`src-tauri/src/render/image_processing.rs:1985` and
`src-tauri/src/render/image_processing.rs:2194`). Resetting adjustments writes `{}` to
the sidecar, not `null` (`src-tauri/src/library/file_management.rs:2205`).

## Ratings, Color Labels, And Tags

Ratings are stored in `ImageMetadata.rating`. `set_rating_for_paths` loads each
path's sidecar, assigns the supplied `u8`, pretty-prints the whole metadata
object, and optionally syncs XMP (`src-tauri/src/library/file_management.rs:2433`).

Color labels are stored inside `ImageMetadata.tags` with the prefix `color:`.
`set_color_label_for_paths` removes all existing `color:` tags, optionally adds
one new `color:<name>` tag, and clears `tags` back to `None` when no tags remain
(`src-tauri/src/library/file_management.rs:2391`). The frontend color label set is
currently `red`, `yellow`, `green`, `blue`, and `purple`
(`src/utils/adjustments.ts:359`).

User-created tags are stored with the prefix `user:`. AI-generated tags are
stored as plain strings. Tag commands sort and deduplicate the full tag list and
set `tags` to `None` when it becomes empty (`src-tauri/src/tagging.rs:416`).

Bulk maintenance commands treat prefixes as follows:

- `clear_ai_tags` removes plain AI tags and keeps `color:` and `user:` tags.
- `clear_all_tags` removes plain AI tags and `user:` tags, but keeps `color:`
  tags.

These commands scan `.rrdata` files recursively under the supplied root
(`src-tauri/src/tagging.rs:468`).

## EXIF Persistence And Legacy `.rrexif`

Current EXIF persistence writes EXIF into the primary `.rrdata` file's `exif`
field. The old legacy EXIF file name was:

```text
/folder/IMG_0001.CR3.rrexif
```

`read_rrexif_sidecar` first checks the primary `.rrdata` for `exif`. If no EXIF
map is present and a legacy `.rrexif` exists, it parses that legacy JSON map,
writes it into the primary `.rrdata`, removes the `.rrexif` on successful save,
and returns the map (`src-tauri/src/exif_processing.rs:1097`).

`read_exif_data` and `persist_exif_if_missing` also backfill extracted EXIF into
the primary `.rrdata` when EXIF is missing
(`src-tauri/src/exif_processing.rs:1136` and
`src-tauri/src/exif_processing.rs:1151`). `write_rrexif_sidecar` keeps its
legacy name, but it now writes the source EXIF map into the target image's
primary `.rrdata` (`src-tauri/src/exif_processing.rs:1185`).

EXIF field edits are physical-image scoped. The frontend strips any `?vc=`
component before calling `update_exif_fields`
(`src/hooks/useLibraryActions.ts:111`), and the Rust command writes the primary
physical sidecar with `get_primary_sidecar_path`
(`src-tauri/src/library/file_management.rs:234`).

## XMP Sync

XMP sync is enabled by default in app settings, while creating missing XMP files
is disabled by default (`src-tauri/src/app/settings.rs:470`). The two settings
are `enable_xmp_sync` and `create_xmp_if_missing`.

When enabled, reads can import data from a sibling `.xmp` or `.XMP` file:

- `load_metadata`, directory listing, recursive listing, and album reads call
  `sync_metadata_from_xmp`.
- XMP rating is imported only when the current sidecar rating is `0`.
- Imported XMP rating also writes a `rating` property into `adjustments`.
- XMP `dc:subject` tags are appended to the sidecar tag list if not already
  present.
- XMP `xmp:Label` becomes a lowercased `color:<label>` tag and replaces any
  existing `color:` tag.

Writes can export rating, color label, and non-color tags to XMP through
`sync_metadata_to_xmp`:

- It updates or inserts `xmp:Rating`.
- It converts the last encountered `color:<name>` tag to a capitalized
  `xmp:Label`.
- It writes non-color tags into `dc:subject` / `rdf:Bag`.
- It removes `xmp:Label` when no color tag exists.
- It removes `dc:subject` when there are no non-color tags.
- It does not sync adjustments or the EXIF map.

If no XMP exists, the writer returns unless `create_xmp_if_missing` is true. When
creation is allowed, it writes a minimal XMP skeleton next to the source image
(`src-tauri/src/library/file_management.rs:3508`).

## Read And Write Flow

Editor load:

1. The frontend calls `load_metadata` before full image decode
   (`src/hooks/useImageLoader.ts:36`).
2. Rust parses the virtual path into physical image path and sidecar path.
3. Rust loads the sidecar or default metadata.
4. If XMP sync is enabled, Rust merges selected XMP metadata into the loaded
   metadata and writes the sidecar if the merge changed it.
5. The frontend normalizes loaded adjustments against `INITIAL_ADJUSTMENTS`.

Full image load:

1. `load_image` parses the virtual path.
2. It loads the sidecar metadata for that physical or virtual copy.
3. It decodes the physical source image.
4. It reads EXIF from the physical image path, using primary `.rrdata` EXIF,
   legacy `.rrexif`, or file extraction as needed
   (`src-tauri/src/io/image_loader.rs:372`).

Editor save:

1. The frontend debounces editor saves by 300 ms and calls
   `save_metadata_and_update_thumbnail`.
2. Rust loads the target sidecar for the physical path or virtual path.
3. Lens parameters may be resolved into the adjustment JSON using existing EXIF.
4. Rust replaces `metadata.adjustments` and writes the full sidecar as
   pretty-printed JSON.
5. If XMP sync is enabled, Rust writes rating, label, and tags to the physical
   image's sibling XMP.
6. Rust queues thumbnail regeneration.

Bulk adjustment writes:

- `apply_adjustments_to_paths` merges supplied adjustment keys into each target
  sidecar.
- `reset_adjustments_for_paths` writes `{}` to `adjustments`.
- `apply_auto_adjustments_to_paths` merges auto adjustment keys, with special
  merge behavior for `sectionVisibility`.

Filesystem operations:

- Physical duplicate/import paths copy the current source `.rrdata` and also
  copy legacy `.rrexif` if present (`src-tauri/src/library/file_management.rs:1785` and
  `src-tauri/src/library/file_management.rs:3104`).
- Physical delete finds and trashes the source image, primary `.rrdata`, virtual
  copy `.rrdata` files, and legacy `.rrexif`
  (`src-tauri/src/library/file_management.rs:1814`).
- Virtual copy delete only trashes the virtual copy sidecar.
- Rename operations rename primary `.rrdata`, virtual-copy `.rrdata`, and legacy
  `.rrexif` files with the image (`src-tauri/src/library/file_management.rs:3264`).

## Compatibility And Error Behavior

- Missing, unreadable, or invalid sidecars are treated as default metadata.
  Later writes can replace an invalid file with fresh metadata without surfacing
  the parse failure to the caller.
- Many bulk commands log or ignore per-file write errors inside parallel loops
  and still return `Ok(())`.
- Sidecar writes use direct `fs::write` rather than a temp-file plus atomic
  rename.
- Multiple commands can write the same sidecar concurrently; the current format
  has no merge token, mtime guard, or conflict detection.
- XMP parsing and writing is string/regex based. Tag values are written into
  XML text without XML escaping in the observed code path.
- Virtual-copy sidecars are separate, but XMP is keyed only by the physical
  source path. Writing metadata from a virtual copy can update the physical
  image's shared XMP rating, label, and tags.
- EXIF is effectively physical-image scoped in current UI edit flow, while
  adjustments, rating, color labels, and tags can be virtual-copy scoped.
- The `version` field exists, but this audit did not find sidecar-version-based
  migrations or compatibility branching.

## Risks And Gaps For Future Sidecar, Catalog, Or Layer Work

- The `adjustments` object is flexible and frontend-owned. Future catalog or
  layer migrations need to preserve unknown keys, especially optional mask,
  AI-patch, LUT, curve, parametric-curve, and lens fields.
- Top-level `rating` and the XMP-imported `adjustments.rating` key can diverge
  because rendering/editor code primarily treats rating as top-level metadata.
- The six-character virtual-copy ID is compact and scanner-recognized only when
  it is lowercase hex. Future naming changes need to keep scanner, rename,
  delete, and parse behavior aligned.
- Legacy `.rrexif` migration is opportunistic and read-triggered. A catalog
  importer should expect both migrated primary sidecars and leftover legacy
  `.rrexif` files.
- XMP sync is partial compatibility sync, not a full sidecar export. It covers
  ratings, labels, and non-color tags only.
- Shared physical XMP creates ambiguity for virtual copies. Current behavior
  cannot represent different virtual-copy ratings/tags in separate XMP files.
- Direct whole-file JSON writes and silent per-file bulk errors are fragile for
  future higher-value catalog/layer data unless covered by stronger write and
  validation guarantees.
