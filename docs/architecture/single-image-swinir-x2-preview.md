# Single-image classical SwinIR x2 preview contract

Status: **capability disabled**. This document defines the release gate and the native-preview contract for issue #5119; it does not authorize or ship model weights.

## Decision record

### Checkpoint rights are a separate gate

Repository-visible evidence at upstream commit `6545850fbf8df298df73d81f3e8cba638787c8bd` establishes the following:

- `JingyunLiang/SwinIR/LICENSE` contains Apache-2.0 for the source work.
- `JingyunLiang/SwinIR/README.md` describes the project/code as Apache-2.0 and links pretrained models.
- `JingyunLiang/SwinIR/main_test_swinir.py` names and automatically downloads `001_classicalSR_DIV2K_s48w8_SwinIR-M_x2.pth` from release tag `v0.0`.
- No checkpoint-specific license, NOTICE, redistribution grant, or other weight-license evidence is attached to that checkpoint in the reviewed repository files.

Availability from a GitHub release is not a redistribution grant. The source-code license therefore does **not** prove that RapidRaw may redistribute the checkpoint or an ONNX derivative of it.

`tools/models/swinir/manifest.json` records that distinction. While `checkpoint.redistributionStatus` is `unproven`, the repository must contain none of the following:

- checkpoint bytes;
- converted ONNX bytes;
- a checkpoint or ONNX download URL;
- a release checkpoint hash or ONNX hash;
- an enabled product capability.

A future change may set the checkpoint and ONNX statuses to `approved` only when it includes reviewable checkpoint-specific evidence, immutable SHA-256 values, artifact byte size, a permitted distribution endpoint, and a native runtime review. Merely enabling the Cargo feature is insufficient.

### Scope that cannot be accepted in this PR

The issue's real-model acceptance criteria cannot be met honestly until the external checkpoint-rights fact is resolved. This PR can implement the fail-closed schema, native dispatch, numerical contracts, UI surface, export tooling, and validation gates. It cannot produce a real ONNX preview, visual parity proof, performance number, or Alaska image artifact without an approved checkpoint/ONNX artifact.

The PR therefore references rather than closes #5119. No durable apply, export, sidecar, burst reconstruction, or existing burst registration behavior is changed.

## Native API boundary

The existing `plan_super_resolution` Tauri command remains the sole registration point.

- Existing `sourceMode: "multi_image"` requests are forwarded unchanged to the bounded burst registration runtime.
- `sourceMode: "single_image_ai"` requests are dispatched before burst decoding.
- The single-image branch returns `singleImageSwinIrPreviewPlanV1Schema`.
- With the current manifest it returns `status: "capability_disabled"`, `accepted: false`, `jobId: null`, and `publication: null` without reading the source, allocating a computational job, downloading anything, or writing a file.
- Exactly one source is required. Invalid source count is reported as `single_image_source_count_must_be_one`, but it never overrides the licensing block.

This untagged response is safe for the existing burst caller because the burst JSON shape is unchanged. The modal parses the single-image response with its own strict schema.

## Release model manifest

The immutable architecture identity is classical SwinIR x2:

| Field | Value |
| --- | --- |
| task | `classical_sr` |
| scale | `2` |
| channels | `3` |
| window | `8` |
| image range | `1` |
| depths | `[6, 6, 6, 6, 6, 6]` |
| embedding dimension | `180` |
| heads | `[6, 6, 6, 6, 6, 6]` |
| MLP ratio | `2` |
| upsampler | `pixelshuffle` |
| residual connection | `1conv` |
| checkpoint key | `params` |
| ONNX names | `input`, `output` |
| ONNX opset | `17` |

`tools/models/swinir/export_swinir_x2.py` never downloads a checkpoint. It requires a caller-provided checkpoint, expected SHA-256, and an upstream source checkout pinned to the reviewed commit. It exports dynamic height/width axes and compares ONNX Runtime CPU output against PyTorch before printing the resulting artifact hash. The tool does not approve the artifact or mutate the release manifest.

## Image-domain contract

### Source

An enabled implementation must consume an accepted current-edit render identified by both an opaque temporary render handle and its exact edit-graph revision. A library path or display-managed screenshot is not an acceptable substitute. The render is scene-linear RGB in the editor's working primaries, finite, correctly oriented, and at the preview's source dimensions.

The current disabled implementation deliberately does not pretend that the existing path-only burst request satisfies this requirement. Before enabling the capability, the command request must gain a render handle and graph revision from the editor render service.

### Model branch

For each finite scene-linear channel `L`, the model branch uses:

```text
Lmodel = clamp(L, 0, 1)
E = 12.92 * Lmodel                                      when Lmodel <= 0.0031308
E = 1.055 * Lmodel^(1/2.4) - 0.055                     otherwise
```

The ONNX input is contiguous `float32` NCHW RGB, batch 1, encoded sRGB, range `[0, 1]`. Dimensions are reflect-padded to the next multiple of 8. The exact, unpadded output crop is `2W x 2H`.

The model output is interpreted as encoded sRGB RGB. Values are required to be finite and are clamped to `[0, 1]` only at the model-domain decode boundary:

```text
L = E / 12.92                                           when E <= 0.04045
L = ((E + 0.055) / 1.055)^2.4                          otherwise
```

### Scene-linear baseline

The non-AI baseline is a separable x2 Mitchell-Netravali bicubic resample in scene-linear working RGB with `B = C = 1/3`, pixel-center mapping `(x + 0.5) / 2 - 0.5`, and reflect-101 boundary addressing. The baseline retains finite negative and greater-than-one values; it is not clamped.

A second baseline branch is clamped to `[0, 1]`, encoded to sRGB, and decoded by the same transfer function solely to place the model residual in scene-linear units.

### Residual and extended highlights

For each output pixel:

```text
Rlinear = decode_sRGB(model_encoded) - decode_sRGB(model_baseline_encoded)
output_scene_linear = baseline_scene_linear + w * Rlinear
```

`w` is one scalar for the RGB pixel, equal to the minimum channel guard weight. A scalar weight avoids hue shifts caused by independent per-channel highlight suppression.

For each finite baseline channel `v`:

- `w_channel = 0` at and below `-0.02`;
- a raised-cosine ramp increases from 0 to 1 over `(-0.02, 0)`;
- `w_channel = 1` over `[0, 1]`;
- a raised-cosine ramp decreases from 1 to 0 over `(1, 1.25)`;
- `w_channel = 0` at and above `1.25`.

No final clamp is permitted. Extended highlights and negative working values therefore remain exactly on the scene-linear bicubic baseline once the guard reaches zero. Any non-finite source, baseline, model tensor, accumulator, or composite value fails the job and publishes nothing.

Contract IDs:

- `encoded_srgb_nchw_f32_unit_v1`
- `scene_linear_bicubic_mitchell_x2_v1`
- `encoded_srgb_residual_scene_linear_guarded_v1`

## Bounded overlap tiling

The generic tile planner from #5257 remains the memory and deterministic row-major skeleton. Its `core_only` ownership is not relabeled as a weighted blend; the SwinIR family adds a distinct contribution policy:

- low-resolution core: `256 x 256` requested;
- model context halo: 64 low-resolution pixels on each side, reflect-padded at the image boundary;
- contribution overlap: 64 low-resolution pixels on each interior side;
- output scale: exactly 2;
- tile traversal: row-major;
- channel traversal: RGB order;
- accumulation: `f64` weighted sums plus `f64` weight sum;
- window: separable raised cosine evaluated at pixel centers;
- outer image edges: weight 1, not tapered;
- normalization: one division after the last contributing tile;
- crop: exact `2W x 2H` after normalization.

A production implementation must not allocate full-frame floating-point accumulators outside the accepted budget. It must use row strips: retain only output rows that can still receive contributions from the current or next tile row, normalize and encode finalized rows in order, then release them. The tile-plan estimate must include model input/output tensors, encoded and scene-linear scratch, strip accumulators, weights, ONNX Runtime session overhead allowance, and encoder buffer with the existing safety margin.

The output must be bitwise deterministic for a fixed model/runtime/platform configuration because tile order and accumulation order are fixed. Cross-provider or cross-architecture bitwise equality is not promised; parity thresholds apply there.

Contract ID: `swinir_x2_overlap_raised_cosine_row_major_v1`.

## Cancellation, staleness, and publication

When the capability becomes available, the enabled path must use the neutral computational job registry from #5257 and these rules:

1. Start one exact `SuperResolution` job and return its UUID. Never use family-wide cancellation for this modal because burst registration may exist concurrently.
2. Check the cancellation token before decode, before and after every ONNX tile, while blending each strip, before encoding, before staleness validation, and immediately before commit.
3. Capture source content hash, render handle, graph revision, settings hash, model hash, and tile-plan hash in the plan identity.
4. Write all preview bytes and metadata to a sibling temporary package. No UI-visible handle may point at it.
5. Re-read the current edit-graph revision after encoding. A mismatch returns `stale`, deletes the package, and publishes nothing.
6. Re-check cancellation and job ownership.
7. Atomically rename the complete package into the session preview cache and only then publish the response.
8. A late result is ignored in the UI by request generation and job ID.
9. Closing the modal cancels by exact job ID. Cancellation, failure, and staleness leave no partial file and no durable graph mutation.

Contract ID: `temp_package_stale_check_atomic_rename_v1`.

## UI contract

The existing `SuperResolutionModal` keeps burst mode as its default and preserves its settings and command path. A separate `Single image AI x2` mode:

- requires exactly one source;
- displays fixed x2, encoded-sRGB model-domain, scene-linear residual, manual-review, and preview-only facts;
- invokes the native plan only as a capability probe while rights remain unproven;
- shows the native block codes;
- keeps the enhancement action disabled;
- exposes no Apply, Save, Export, sidecar, or burst-setting mutation;
- discards late probe results with a local generation counter.

## Minimum validation set

### Always-on schema/UI checks

- strict schema rejects unknown fields and any disabled response that carries a job or publication;
- manifest check proves source license and checkpoint-rights status are separate;
- unproven manifest rejects any checkpoint/ONNX hash or download URL;
- package and frontend schemas parse the same disabled response;
- modal contains both modes, invokes the existing native plan command, and leaves enhancement disabled for a disabled capability;
- burst `sourceMode: "multi_image"` route remains unchanged.

### Rust unit checks

- encoded-sRGB transfer breakpoints and round trip;
- in-gamut residual application;
- scalar taper and exact extended-highlight preservation at `-0.02` and `1.25`;
- non-finite rejection;
- Mitchell kernel support;
- odd/small/multi-tile plans, row-major order, memory bound, and raised-cosine symmetry;
- disabled plan starts no job and publishes no artifact;
- source count is exactly one.

### Model-enabled parity/runtime checks — blocked today

After an approved artifact exists, one private, opt-in test must compare full-frame PyTorch, full-frame ONNX Runtime CPU, and tiled ONNX Runtime CPU on deterministic synthetic and photographic crops. Required gates:

- PyTorch vs full-frame ORT: max absolute encoded-SRGB error `<= 3e-4`, mean absolute error `<= 3e-5`;
- full-frame vs tiled scene-linear output: max absolute error `<= 5e-4`, mean absolute error `<= 5e-5`;
- seam band error does not exceed non-seam error by more than `1e-4`;
- exact output dimensions for odd and sub-window inputs;
- bounded peak estimate does not exceed the accepted budget;
- cancellation at every stage produces no publication;
- graph-revision mutation before commit produces `stale` and no publication;
- automatic quality checks never bypass manual review.

### Private Alaska proof — blocked today

The ignored Rust test `private_alaska_native_proof_remains_fail_closed` accepts `RAWENGINE_PRIVATE_ALASKA_SINGLE_IMAGE_PATH` and currently proves only that the private fixture cannot create a job or artifact while rights are unproven. A real Alaska output, 100%/200% crop sheet, downscale reconstruction metric, seam metric, false-detail review, runtime, and peak-memory receipt are invalid evidence until the approved model gate is satisfied.
