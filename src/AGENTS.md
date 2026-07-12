# Frontend Scope

Inherits the repository-root instructions. This file applies under `src/`.

- Keep React components declarative; put orchestration in hooks and pure policy/identity logic in `utils/`.
- Treat `schemas/` as the runtime-validation boundary. Parse Tauri/event payloads before product code consumes them.
- Add or update typed command wrappers in `tauri/`; do not call stringly typed IPC ad hoc.
- Preserve editor session, artifact, and revision identities through async work; stale completions must be rejected.
- UI claims require browser/native automation; pair interaction changes with focused pure tests where logic can be isolated.
- Update every locale when adding user-visible strings; do not hide missing translations behind fallbacks.
- Keep validation harness behavior product-faithful and confined to `validation/` entrypoints.
