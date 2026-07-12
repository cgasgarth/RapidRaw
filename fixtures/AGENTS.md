# Fixture Scope

Inherits the repository-root instructions. This file applies under `fixtures/`.

- Commit only synthetic, redistributable, or clearly licensed fixtures; private user media belongs outside the repository.
- Keep fixtures minimal and stable. Record provenance, encoding/color space, dimensions, and expected identity when relevant.
- Expected outputs must represent product contracts, not implementation accidents or unstable timestamps.
- Regenerate through a maintained script when practical and review binary size/hash changes intentionally.
- Do not update expected artifacts merely to make a failing regression pass; establish why the new output is correct.
