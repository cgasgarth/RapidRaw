# AI Provider Abstraction

Issue: #209 `ai(api): define provider abstraction for local self-hosted and cloud AI`

## Scope

This slice defines the first TypeScript-facing AI provider contract without
changing runtime behavior.

The contract lives in `src/schemas/aiProviderSchemas.ts` and is backed by Zod so
settings, UI, future app-server tools, and provenance code can validate provider
IDs instead of accepting arbitrary strings.

## Provider IDs

| Provider ID    | Current meaning                                    | Current UI exposure          |
| -------------- | -------------------------------------------------- | ---------------------------- |
| `cpu`          | Built-in local models and local fallback behavior. | Visible in settings.         |
| `ai-connector` | Self-hosted/local HTTP connector.                  | Visible in settings.         |
| `cloud`        | RapidRAW cloud path gated by auth/pro status.      | Latent code path, hidden UI. |
| `app-server`   | Future RawEngine Codex app-server provider path.   | Contract only, hidden UI.    |

Unknown provider values normalize to `cpu`. This preserves existing fallback
behavior while preventing unbounded provider strings from spreading through new
TypeScript code.

## Wired Surfaces

- `SettingsPanel` uses the provider ID type for provider switch state and change
  handlers.
- `AIPanel` normalizes persisted settings before checking cloud or connector
  availability.
- Existing settings persistence remains string-compatible so current sidecars
  and Rust settings do not need a migration in this PR.

## Follow-Up Work

- Add Rust-side provider enum parsing and serde migration once command-layer
  schemas are ready.
- Add provider provenance to AI outputs and sidecars.
- Add explicit approval requirements for cloud, connector, and app-server
  provider-backed edits.
- Add app-server provider behavior only after the tool schema package and
  approval/audit surfaces exist.
