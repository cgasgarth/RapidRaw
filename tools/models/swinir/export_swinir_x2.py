#!/usr/bin/env python3
"""Export the reviewed classical SwinIR x2 architecture without downloading weights.

This tool is deliberately not a release-approval mechanism. It requires a caller-
provided checkpoint and license-evidence file, verifies the exact checkpoint hash
and upstream source commit, exports ONNX, and performs a local PyTorch/ORT parity
check. The release manifest must be reviewed and updated separately.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

UPSTREAM_COMMIT = "6545850fbf8df298df73d81f3e8cba638787c8bd"
CHECKPOINT_NAME = "001_classicalSR_DIV2K_s48w8_SwinIR-M_x2.pth"
INPUT_NAME = "input"
OUTPUT_NAME = "output"
OPSET = 17
MAX_ABS_TOLERANCE = 3.0e-4
MEAN_ABS_TOLERANCE = 3.0e-5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--swinir-source", type=Path, required=True, help="Git checkout of JingyunLiang/SwinIR")
    parser.add_argument("--checkpoint", type=Path, required=True, help="Locally supplied licensed checkpoint")
    parser.add_argument("--expected-checkpoint-sha256", required=True, help="64 lowercase hexadecimal characters")
    parser.add_argument(
        "--checkpoint-license-evidence",
        type=Path,
        required=True,
        help="Local checkpoint-specific license/grant reviewed by the caller; never copied into the ONNX file",
    )
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_file(path: Path, label: str) -> None:
    if not path.is_file():
        raise SystemExit(f"{label} is not a file: {path}")


def require_reviewed_source(source: Path) -> None:
    require_file(source / "models" / "network_swinir.py", "SwinIR architecture source")
    try:
        commit = subprocess.check_output(
            ["git", "-C", str(source), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.STDOUT,
        ).strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"SwinIR source must be a Git checkout at {UPSTREAM_COMMIT}: {error}") from error
    if commit != UPSTREAM_COMMIT:
        raise SystemExit(f"SwinIR source commit mismatch: expected {UPSTREAM_COMMIT}, got {commit}")


def load_model(source: Path, checkpoint_path: Path) -> Any:
    import torch

    sys.path.insert(0, str(source))
    from models.network_swinir import SwinIR  # type: ignore[import-not-found]  # noqa: PLC0415

    model = SwinIR(
        upscale=2,
        in_chans=3,
        img_size=48,
        window_size=8,
        img_range=1.0,
        depths=[6, 6, 6, 6, 6, 6],
        embed_dim=180,
        num_heads=[6, 6, 6, 6, 6, 6],
        mlp_ratio=2,
        upsampler="pixelshuffle",
        resi_connection="1conv",
    )
    checkpoint = torch.load(checkpoint_path, map_location="cpu")
    if not isinstance(checkpoint, dict):
        raise SystemExit("checkpoint is not a state-dict container")
    state = checkpoint.get("params", checkpoint)
    model.load_state_dict(state, strict=True)
    model.eval()
    return model


def export_and_validate(model: Any, output: Path) -> dict[str, float | int | str]:
    import numpy as np
    import onnxruntime as ort
    import torch

    if output.exists():
        raise SystemExit(f"refusing to overwrite existing output: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    generator = torch.Generator(device="cpu")
    generator.manual_seed(5119)
    sample = torch.rand((1, 3, 64, 72), generator=generator, dtype=torch.float32)

    with torch.no_grad():
        expected = model(sample).detach().cpu().numpy()

    torch.onnx.export(
        model,
        sample,
        output,
        export_params=True,
        opset_version=OPSET,
        do_constant_folding=True,
        input_names=[INPUT_NAME],
        output_names=[OUTPUT_NAME],
        dynamic_axes={
            INPUT_NAME: {2: "height", 3: "width"},
            OUTPUT_NAME: {2: "height_x2", 3: "width_x2"},
        },
    )

    session = ort.InferenceSession(str(output), providers=["CPUExecutionProvider"])
    actual = session.run([OUTPUT_NAME], {INPUT_NAME: sample.numpy()})[0]
    if actual.shape != expected.shape:
        output.unlink(missing_ok=True)
        raise SystemExit(f"ONNX shape mismatch: PyTorch {expected.shape}, ORT {actual.shape}")

    delta = np.abs(actual.astype(np.float64) - expected.astype(np.float64))
    max_abs = float(delta.max(initial=0.0))
    mean_abs = float(delta.mean())
    if max_abs > MAX_ABS_TOLERANCE or mean_abs > MEAN_ABS_TOLERANCE:
        output.unlink(missing_ok=True)
        raise SystemExit(
            f"ONNX parity failed: max_abs={max_abs:.8g} (limit {MAX_ABS_TOLERANCE}), "
            f"mean_abs={mean_abs:.8g} (limit {MEAN_ABS_TOLERANCE})"
        )

    return {
        "bytes": output.stat().st_size,
        "inputName": INPUT_NAME,
        "maxAbsError": max_abs,
        "meanAbsError": mean_abs,
        "opset": OPSET,
        "outputName": OUTPUT_NAME,
        "sha256": f"sha256:{sha256(output)}",
    }


def main() -> None:
    args = parse_args()
    require_file(args.checkpoint, "checkpoint")
    require_file(args.checkpoint_license_evidence, "checkpoint license evidence")
    if args.checkpoint_license_evidence.stat().st_size == 0:
        raise SystemExit("checkpoint license evidence is empty")
    if args.checkpoint.name != CHECKPOINT_NAME:
        raise SystemExit(f"checkpoint filename mismatch: expected {CHECKPOINT_NAME}")
    expected_hash = args.expected_checkpoint_sha256.lower()
    if len(expected_hash) != 64 or any(character not in "0123456789abcdef" for character in expected_hash):
        raise SystemExit("--expected-checkpoint-sha256 must be 64 lowercase hexadecimal characters")
    actual_hash = sha256(args.checkpoint)
    if actual_hash != expected_hash:
        raise SystemExit(f"checkpoint SHA-256 mismatch: expected {expected_hash}, got {actual_hash}")

    require_reviewed_source(args.swinir_source)
    model = load_model(args.swinir_source, args.checkpoint)
    result = export_and_validate(model, args.output)
    result.update(
        {
            "checkpointSha256": f"sha256:{actual_hash}",
            "sourceCommit": UPSTREAM_COMMIT,
            "warning": "This output is not release-approved; update manifest only after checkpoint-rights review.",
        }
    )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
