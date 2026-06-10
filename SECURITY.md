# Security Policy

## Supported Versions

RawEngine is early fork work on top of RapidRAW. Until the project has tagged RawEngine releases, security fixes target the current `main` branch.

| Version                           | Supported                                                           |
| --------------------------------- | ------------------------------------------------------------------- |
| `main`                            | Yes                                                                 |
| Tagged RapidRAW upstream releases | No, report those upstream unless the issue is specific to this fork |
| Old RawEngine branches            | No                                                                  |

## Reporting A Vulnerability

Use GitHub private vulnerability reporting or a private GitHub security advisory for this repository when available. Do not open a public issue with exploit details, private image files, credentials, or other sensitive material.

If private reporting is unavailable, open a public issue with a minimal summary and mark it as security-sensitive, but omit proof-of-concept details until a maintainer can move the discussion to a private channel.

Reports should include:

- Affected platform and version or commit SHA.
- Whether the issue affects the Rust/Tauri backend, TypeScript/React frontend, image-processing pipeline, dependency chain, app-server tools, or release packaging.
- Reproduction steps using non-sensitive files when possible.
- Expected impact.
- Any known workaround.

## Handling Policy

- Do not modify original user image files while investigating a report.
- Treat sample images, sidecars, logs, and exported artifacts as potentially sensitive.
- Prefer small security PRs with clear validation evidence.
- Dependency alerts should be fixed promptly when a safe patch exists.
- If a dependency alert is blocked by an upstream or platform stack constraint, document the blocker in the linked issue and keep a follow-up issue open.

## Disclosure

Security fixes should ship through pull requests. Public disclosure should wait until a fix or mitigation is available, unless the issue is already public through an upstream advisory.
