# Selected-image audit export

The selected-image review workspace enables **Export Audit** after a typed dry-run has produced an audit record. An approved apply is reflected in the same receipt when it occurs before export.

In the desktop app, export opens the native save dialog and writes formatted JSON to the chosen path through the Tauri filesystem plugin. RawEngine reads that file back and validates it with `agentSelectedImageLiveSessionAuditExportReceiptSchema` before reporting success. The result shows the saved path, schema validation state, and replay preflight state.

Browser and browser-Tauri harness runs do not claim native output. They use a browser download artifact, identify the result as `browser_fallback`, and show the fallback filename. Both modes record the export request id, `rawengine.agent.audit.export` tool name, graph revision, and output path or filename in the workspace timeline.

The exported receipt contains sanitized selected-image identity, request ids, graph revisions, recipe and preview hashes, approval and rollback state, tool names, and replay preflight proof. It does not contain image bytes or the selected image's private path.
