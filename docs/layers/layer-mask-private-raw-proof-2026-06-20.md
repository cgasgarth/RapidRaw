# Layer Mask Private RAW Proof

Issue: #2310

The layer/mask real RAW proof uses the project-owned Alaska RAW source recorded
in `fixtures/detail/proofs/private-raw-evidence-ledger.json`. The RAW payload remains
local-only and ignored.

Prepare the private root from the approved source folder:

```sh
RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-layer-mask-alaska-proof RAWENGINE_PRIVATE_RAW_SOURCE="/Users/cgas/Pictures/Capture One/Alaska" bun run prepare:layer-mask-real-raw-private-root -- --require-assets
```

Then run the runtime proof and UI review smoke:

```sh
RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-layer-mask-alaska-proof bun run check:layer-mask-real-raw-proof -- --require-assets
RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-layer-mask-alaska-proof bun run check:layer-mask-private-raw-ui-proof
```

This proves private RAW decode, layer mask generation, masked pixel changes,
mask refinement pixel changes, and preview/export parity. It does not prove a
full macOS manual app session or manual layer panel interaction.
