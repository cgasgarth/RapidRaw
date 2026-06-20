# Private RAW Source Ingest

Project-owned RAW folders can be used as local validation input without committing RAW payloads.

For HDR fixture prep, point the existing private root preparer at a local source folder:

```sh
RAWENGINE_PRIVATE_RAW_ROOT="$(pwd)" bun scripts/prepare-hdr-real-raw-private-root.ts --source "/absolute/path/to/raw-folder" --materialize symlink
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
RAWENGINE_PRIVATE_RAW_ROOT="$(pwd)" bun scripts/prepare-panorama-real-raw-private-root.ts --source "/absolute/path/to/raw-folder" --materialize symlink
```

The panorama selector looks for an ordered project-owned RAW sequence with matching camera, lens, focal length, aperture, ISO, and shutter speed. This proves local fixture materialization only; panorama runtime proof still requires the dedicated private proof runner.

Validation rules:

- RAW payloads stay local and ignored.
- The selected trio must be same camera/lens metadata, close in capture time, close in sequence number, and at least 4 EV apart.
- Panorama selections must preserve a consistent exposure/capture setup and ordered frame sequence.
- Use `--materialize copy` when symlinks are not suitable for downstream tooling.
