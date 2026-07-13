# Color-science conformance lab

Issue [#5413](https://github.com/cgasgarth/RapidRaw/issues/5413) owns the repository's
versioned color-quality platform. The independent `rapidraw-color-reference` crate uses
auditable f64 equations and does not import production shader or optimized color math.

## Implemented coverage

| Area | Independent proof |
| --- | --- |
| Input and adaptation | AP1/XYZ matrices, Bradford, CAT16, dual-illuminant DCP vectors, camera/illuminant RAW tests |
| Transfer and HDR | sRGB, Rec.2020, PQ, HLG, absolute Rec.2100 RGB to ICtCp, DeltaEITP |
| Perceptual metrics | XYZ to/from CIE Lab, DeltaE76, DeltaE2000, hue/chroma/lightness and gamut metrics |
| Creative graph | curves, levels, HSL, grading, calibration, LUT, local masks, clipping, spatial effects |
| Pipeline integrity | typed domains, stage hashes/receipts, double-transfer and premature-clamp defect injection |
| Fixtures | hashed RGB, Lab, CFA, spatial, SDR/HDR transfer, Rec.2100 and D50 XYZ families |
| Governance | stage-specific tolerances, fail-closed comparison, atomic approval audit records, hardware isolation |

Production CPU/WGPU, preview/export, ICC/output-byte, real-RAW, and native display tests remain
separate from the independent crate so shared production bugs cannot validate themselves.

## Run tiers

Compute the graph identity exactly as CI does, then choose one tier:

```sh
GRAPH="$(git ls-files -s src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/color src-tauri/src/raw src-tauri/src/render src-tauri/src/export src-tauri/crates/rapidraw-color-reference | shasum -a 256 | cut -d ' ' -f 1)"
bun run color-lab -- run --affected --graph "$GRAPH" --output artifacts/color-lab-fast --cache .cache/color-lab
bun run color-lab -- run --full --no-cache --graph "$GRAPH" --output artifacts/color-lab-full
```

The fast PR tier is content-addressed. Full runs bypass the cache. Hardware runs additionally
require `--backend`, `--vendor`, `--device`, and `--driver`; use the manual
`color-lab-hardware.yml` workflow so the report records the native adapter identity.

Each run writes `color-lab-report.json` and a concise human report. Reports bind fixture hashes,
graph identity, operation versions, metric conditions, timings, and hardware identity where
applicable. Generated reports and private camera/display evidence are not source artifacts.

## Baseline governance

Baseline changes are explicit and auditable:

```sh
cargo run --locked --manifest-path src-tauri/Cargo.toml -p rapidraw-color-reference --bin rapidraw-color-baseline -- compare baseline.json candidate.json
cargo run --locked --manifest-path src-tauri/Cargo.toml -p rapidraw-color-reference --bin rapidraw-color-baseline -- explain baseline.json candidate.json
cargo run --locked --manifest-path src-tauri/Cargo.toml -p rapidraw-color-reference --bin rapidraw-color-baseline -- approve baseline.json candidate.json --reviewer NAME --issue ISSUE --reason REASON
```

Approval fails if the candidate fails, loosens tolerance, changes fixture/graph bindings, or uses
an incompatible hardware identity. It appends reviewer, issue, reason, and timestamp metadata via
an atomic write; a failing test cannot automatically rebaseline itself.

## Maintainer contract

New color nodes must add a typed domain/operation, independent vectors, production differential
coverage, and the cheapest affected CI route. Normative equations cite the governing standard in
source. Visual approval is supporting evidence only and never replaces numeric or output-byte proof.
