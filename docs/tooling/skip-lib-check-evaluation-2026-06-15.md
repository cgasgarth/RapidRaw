# Skip Lib Check Evaluation

- Issue: #1285
- Candidate flag: `skipLibCheck: false`
- Status: evaluated, not enabled

`skipLibCheck: false` was probed by temporarily flipping the root `tsconfig.json` and running `bun run check:types`.

Result: the check failed on dependency declaration noise, not project-owned source:

- `@clerk/shared` declarations conflict with `exactOptionalPropertyTypes`.
- `@tauri-apps/api` declarations use extensionless relative imports that fail under `moduleResolution: nodenext`.
- `@uiw/react-color-wheel` declarations could not resolve `JSX`.
- `simple-icons` declarations combine `export =` with other exported elements.

Decision: keep `skipLibCheck: true` for the root app until dependency declarations are upgraded or isolated. Flipping this now would block PR velocity on third-party declaration issues that do not prove RawEngine source correctness.

Follow-up path:

- Re-test after major dependency upgrades.
- Prefer fixing or upgrading offending packages over suppressing individual declaration errors.
- Keep project-owned schema/package checks strict through `bun run check:types` and `bun run schema:check`.
