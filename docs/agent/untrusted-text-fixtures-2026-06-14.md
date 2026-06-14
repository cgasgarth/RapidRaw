# Agent Untrusted Text Fixtures

- Issue: #229 `validation(agent): add prompt injection fixtures`
- Scope: validation-only fixtures for agent-visible text that must be treated as data.

RawEngine runs locally, but agent-visible text still needs deterministic handling so filenames, metadata, sidecars, preset text, OCR, and provider responses cannot silently turn into tool calls or approval decisions.

This adds `fixtures/agent/untrusted-agent-text-fixtures.json` and `bun run check:agent-untrusted-text`. The fixture contract requires:

- representative source kinds: metadata, filename, sidecar, provider response, and preset text;
- `data_only` normalization for every case;
- explicit warnings for untrusted text and provider-origin text;
- user approval before mutation or file operations;
- blocked mutation tool names for apply, export, and library mutation paths.

This PR does not implement runtime agent execution. It is a fixture and validation gate for future app-server replay and tool-call tests.
