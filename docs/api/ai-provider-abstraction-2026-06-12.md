# AI Provider Abstraction

Issue: #209 `ai(api): define provider abstraction for local self-hosted and cloud AI`

## Scope

This slice defines the first TypeScript-facing AI provider contract without
changing runtime behavior.

The contract lives in `src/schemas/aiProviderSchemas.ts` and is backed by Zod so
settings, future tool schemas, and provenance code can validate image-provider
IDs instead of accepting arbitrary strings.

## Provider IDs

| Provider ID    | Current meaning                                    | Current UI exposure          |
| -------------- | -------------------------------------------------- | ---------------------------- |
| `cpu`          | Built-in local models and local fallback behavior. | Visible in settings.         |
| `ai-connector` | Self-hosted/local HTTP connector.                  | Visible in settings.         |
| `cloud`        | RapidRAW cloud path gated by auth/pro status.      | Latent code path, hidden UI. |

Unknown provider values normalize to `cpu`. The previous contract-only
`app-server` value also normalizes to `cpu` because app-server is an agent
runtime, not an image AI provider. This preserves existing fallback behavior
while preventing unbounded provider strings from spreading through new
TypeScript code.

## Agent Runtime Split

Issue #869 split the app-server runtime concept into
`src/schemas/agent/agentRuntimeSchemas.ts`.

| Runtime ID   | Current meaning                        | Current UI exposure       |
| ------------ | -------------------------------------- | ------------------------- |
| `app-server` | Future Codex app-server agent runtime. | Contract only, hidden UI. |

Agent runtime schemas are strict. They should describe whether the RawEngine
agent runtime is enabled and which runtime owns the chat/approval/event stream.
They should not be used to choose local, connector, or cloud image-processing
providers.

## Wired Surfaces

- `SettingsPanel` uses the provider ID type for provider switch state and change
  handlers.
- `AIPanel` normalizes persisted settings before checking cloud or connector
  availability.
- `agent/agentRuntimeSchemas.ts` owns the app-server runtime ID separately from image
  providers.
- Existing settings persistence remains string-compatible so current sidecars
  and Rust settings do not need a migration in this PR.

## Follow-Up Work

- Add Rust-side provider enum parsing and serde migration once command-layer
  schemas are ready.
- Add Rust-side agent runtime parsing once app-server lifecycle work begins.
- Add provider provenance to AI outputs and sidecars.
- Add explicit approval requirements for cloud, connector, and future
  app-server-mediated edits.
- Add app-server runtime behavior only after the tool schema package and
  approval/audit surfaces exist.
