# Private RAW Source Ingest

Project-owned RAW folders can be used as local validation input without committing RAW payloads.

For selective-color RAW preview/export proof, point the open/edit/export preparer
at a project-owned source folder. The preparer hashes RAW candidates in that
folder and links the file that matches the private evidence ledger entry:

```sh
RAWENGINE_PRIVATE_RAW_ROOT="$(pwd)" RAWENGINE_PRIVATE_RAW_SOURCE="/absolute/path/to/raw-folder" bun run prepare:raw-open-edit-export-private-root -- --request fixtures/validation/professional-color-workflow/selective-color-raw-proof-request.json --require-assets
```

For HDR fixture prep, point the existing private root preparer at a local source folder:

```sh
RAWENGINE_PRIVATE_RAW_ROOT="$(pwd)" bun scripts/private-raw/prepare/prepare-hdr-real-raw-private-root.ts --source "/absolute/path/to/raw-folder" --materialize symlink
```

The command scans real RAW files, uses ExifTool metadata to find a three-frame HDR bracket candidate, and writes the selected sources into the ignored private fixture layout:

```text
private-fixtures/hdr/bracket-alignment-v1/frame-01-under.arw
private-fixtures/hdr/bracket-alignment-v1/frame-02-mid.arw
private-fixtures/hdr/bracket-alignment-v1/frame-03-over.arw
```

It also writes an ignored local ingest report under `private-artifacts/validation/computational-merge/`.

For panorama fixture prep, use the same pattern:

```sh
RAWENGINE_PRIVATE_RAW_ROOT="$(pwd)" bun scripts/private-raw/prepare/prepare-panorama-real-raw-private-root.ts --source "/absolute/path/to/raw-folder" --materialize symlink
```

The panorama selector looks for an ordered project-owned RAW sequence with matching camera, lens, focal length, aperture, ISO, and shutter speed. This proves local fixture materialization only; panorama runtime proof still requires the dedicated private proof runner.

For super-resolution fixture prep, use:

```sh
RAWENGINE_PRIVATE_RAW_ROOT="$(pwd)" bun scripts/private-raw/prepare/prepare-sr-real-raw-private-root.ts --source "/absolute/path/to/raw-folder" --materialize symlink
```

The SR selector uses the same ordered burst requirements as panorama and writes four project-owned RAW sources into `private-fixtures/super-resolution/alaska-burst-v1/`.

For the local Alaska runtime-proof path, point the private root at the Capture One Alaska folder and run the SR wrapper:

```sh
RAWENGINE_PRIVATE_RAW_ROOT="/Users/cgas/Pictures/Capture One/Alaska" bun run run:sr-local-alaska-runtime-sample
```

The wrapper uses the same folder as the source by default, writes ignored symlinks under `private-fixtures/super-resolution/alaska-burst-v1/`, decodes the selected ARWs, and emits the local-only runtime sample at `private-artifacts/validation/computational-merge/sr-subpixel-runtime-sample.json`.

Validation rules:

- RAW payloads stay local and ignored.
- Selective-color open/edit/export source selection must match the ledger hash;
  source folder names are not trusted as proof.
- The selected trio must be same camera/lens metadata, close in capture time, close in sequence number, and at least 4 EV apart.
- Panorama selections must preserve a consistent exposure/capture setup and ordered frame sequence.
- Super-resolution selections must preserve a consistent exposure/capture setup and ordered burst sequence.
- Use `--materialize copy` when symlinks are not suitable for downstream tooling.
