# AGPL Compliance Note

This repository is a public fork of RapidRAW and keeps the upstream AGPL-3.0 license. This note is a project compliance checklist, not legal advice.

## License Source

- Primary license file: [`LICENSE`](LICENSE).
- Upstream project: <https://github.com/CyberTimon/RapidRAW>.
- RawEngine planning source of truth: [`RAW_EDITOR_PLAN.md`](RAW_EDITOR_PLAN.md).

## Fork Obligations

- Keep the AGPL-3.0 license text in the repository.
- Preserve upstream copyright notices and attribution.
- Keep this fork public while distributing modified builds.
- Make corresponding source code available for distributed modified versions.
- Clearly document substantial RawEngine changes in pull requests, release notes, or maintained project docs.
- Do not remove upstream license, copyright, or attribution information without a reviewed reason.

## Network And Agent Features

RawEngine plans to expose editing surfaces through typed APIs and OpenAI app-server based tools. Any network-accessible modified version must be evaluated against AGPL-3.0 source-availability requirements before release.

Before shipping a hosted service, remote agent, or app-server integration:

- Confirm where modified AGPL-covered code runs.
- Confirm how users can obtain corresponding source code.
- Confirm third-party service terms do not conflict with AGPL obligations.
- Confirm generated tools, schemas, bundled models, presets, and assets have compatible licensing.

## Assets, Presets, And Models

- Do not bundle proprietary film LUTs, ICC profiles, manufacturer assets, logos, trade dress, sample images, or model weights unless licensing is reviewed.
- Track provenance for built-in film simulations, negative-lab presets, sample images, fixtures, AI models, and generated assets.
- Prefer project-owned fixtures and legally safe generic presets.

## Release Checklist

Before publishing a RawEngine build:

- Verify `LICENSE` is included.
- Verify this note is still accurate.
- Verify third-party notices and dependency licenses are captured where required.
- Verify source code for the released build is available from the public repository or release artifact.
- Verify any macOS packaging, updater, or app-server component includes a source-code access path appropriate for AGPL-covered code.
