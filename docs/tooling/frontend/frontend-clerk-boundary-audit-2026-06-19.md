# Frontend Clerk Boundary Audit

Issue: #2444

This audit checks whether Clerk auth can move out of the initial frontend entry
without breaking auth-backed AI and settings behavior.

## Measurement

Measured with:

```sh
TAURI_ENV_DEBUG=1 bun run build:frontend
bun run bundle:report
```

After this PR:

| Entry metric | Bytes     |
| ------------ | --------- |
| Initial raw  | 2,713,612 |
| Initial gzip | 776,961   |

The settings UI now builds as a non-initial chunk:

| Chunk                | Initial entry | Raw bytes | Gzip bytes |
| -------------------- | ------------- | --------- | ---------- |
| `SettingsPanel-*.js` | false         | 55,317    | 12,368     |

Clerk still appears in the initial entry because `AppWrapper` owns the root
`ClerkProvider`:

| Package         | Source bytes | Source count |
| --------------- | ------------ | ------------ |
| `@clerk/shared` | 221,085      | 27           |
| `@clerk/react`  | 125,393      | 4            |

## Change In This PR

`src/components/panel/MainLibrary.tsx` lazy-loads the main Settings panel. This
moves Settings-only auth hooks and settings UI code behind the explicit settings
surface while preserving the root provider and existing sign-in behavior.

`src/components/panel/SettingsPanel.tsx` now exposes a named export so the lazy
import can remain strongly typed without cast escape hatches.

## Decision

Do not remove or lazy-load the root `ClerkProvider` in this PR. The provider is
currently the auth context for:

- `SettingsPanel` cloud sign-in and usage controls;
- `AIPanel` cloud auth state and usage;
- `useAiMasking` token requests used by AI mask actions.

Moving the provider to per-surface boundaries is possible, but it is a product
behavior change because multiple auth-backed panels would no longer share one
obvious root auth scope. That deserves a dedicated auth architecture PR with
runtime sign-in proof.

## Follow-Up Policy

- Keep root auth provider changes separate from bundle-only PRs.
- If provider ownership changes later, validate Settings sign-in, AIPanel auth
  state, and AI mask token calls in the running app.
- Bundle proof should include both `bun run check:bundle` and source-map
  attribution from `bun run bundle:report`.
