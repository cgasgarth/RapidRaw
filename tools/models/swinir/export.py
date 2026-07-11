#!/usr/bin/env python3
"""Deterministically export the pinned classical SwinIR x2 checkpoint to ONNX."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import torch


ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / "export_manifest.json").read_text())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_network(source: Path):
    module_path = source / "models" / "network_swinir.py"
    spec = importlib.util.spec_from_file_location("pinned_network_swinir", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.SwinIR


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True, help="Pinned SwinIR checkout")
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    expected_commit = MANIFEST["upstream"]["commit"]
    actual_commit = (args.source / ".git" / "HEAD").read_text().strip()
    if actual_commit.startswith("ref:"):
        actual_commit = (args.source / ".git" / actual_commit.split(" ", 1)[1]).read_text().strip()
    if actual_commit != expected_commit:
        raise RuntimeError(f"SwinIR checkout must be {expected_commit}, got {actual_commit}")
    expected_checkpoint = MANIFEST["checkpoint"]["sha256"]
    if sha256(args.checkpoint) != expected_checkpoint:
        raise RuntimeError("Checkpoint SHA-256 mismatch")

    SwinIR = load_network(args.source)
    model = SwinIR(
        upscale=2,
        in_chans=3,
        img_size=64,
        window_size=8,
        img_range=1.0,
        depths=[6, 6, 6, 6, 6, 6],
        embed_dim=180,
        num_heads=[6, 6, 6, 6, 6, 6],
        mlp_ratio=2,
        upsampler="pixelshuffle",
        resi_connection="1conv",
    ).eval()
    state = torch.load(args.checkpoint, map_location="cpu", weights_only=True)["params"]
    model.load_state_dict(state, strict=True)
    sample = torch.linspace(0.0, 1.0, 1 * 3 * 16 * 24).reshape(1, 3, 16, 24)
    with torch.inference_mode():
        torch.onnx.export(
            model,
            sample,
            args.output,
            input_names=["input"],
            output_names=["output"],
            dynamic_axes={
                "input": {2: "height", 3: "width"},
                "output": {2: "height_x2", 3: "width_x2"},
            },
            opset_version=17,
            do_constant_folding=True,
        )
    print(json.dumps({"onnxSha256": sha256(args.output), "path": str(args.output)}, sort_keys=True))


if __name__ == "__main__":
    main()
