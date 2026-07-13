# Native application profiles

RapidRAW supports two native application profiles with isolated Cargo target directories:

- `full` is the production-complete profile. It includes AI and advanced JXL/WebP capabilities.
- `fast-dev` keeps the shell, library, editor, preview, and basic JPEG/PNG/TIFF export while omitting optional heavy capability leaves.

Run the full application with `bun run start`. Run the fast development application with `bun run start:fast-dev`. Validate both native link graphs with `bun run check:native-profiles`.

The fast target writes to `src-tauri/target/fast-dev`; full-profile checks write to `src-tauri/target/full`. Switching profiles therefore does not invalidate the other profile's native artifacts.

The frontend reads `get_native_capabilities` during initialization. AI polling and advanced export choices are gated from that typed manifest. Disabled backend operations return the stable `capability_unavailable` contract rather than attempting to load absent runtimes.
