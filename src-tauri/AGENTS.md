# Native Runtime Scope

Inherits the repository-root instructions. This file applies under `src-tauri/`.

- Keep `lib.rs` as composition/command wiring; place domain logic in the existing `src/` modules.
- Model cancellation, generations, revisions, and resource ownership explicitly across threads and async tasks.
- Never hold broad mutexes across decode, render, filesystem, network, GPU, or await boundaries.
- Preserve source files: derived outputs use temporary write, sync where required, atomic commit, and typed receipts.
- Display transforms, preview pixels, embedded profiles, and export profiles must follow the documented color contract.
- Platform-specific behavior needs a portable policy/core test plus target-native integration proof when available.
- Run focused Cargo tests first; Rust/Tauri changes ultimately require fmt, strict Clippy, and the maintained required feature suite.
- Private RAW paths are runtime inputs only; no source media, reports, or generated proof artifacts enter Git.
