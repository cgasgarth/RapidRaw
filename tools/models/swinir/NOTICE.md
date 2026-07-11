# SwinIR x2 model notice

RapidRAW contains an optional runtime and reproducible export recipe for the classical SwinIR x2 medium architecture.

- Upstream: <https://github.com/JingyunLiang/SwinIR>
- Pinned source commit: `6545850fbf8df298df73d81f3e8cba638787c8bd`
- Source code license: Apache License 2.0 (see `UPSTREAM-APACHE-2.0.txt`)
- Authors: Jingyun Liang, Jiezhang Cao, Guolei Sun, Kai Zhang, Luc Van Gool, and Radu Timofte
- Paper: *SwinIR: Image Restoration Using Swin Transformer*, arXiv:2108.10257

The upstream release publishes pretrained checkpoint files, but the reviewed upstream materials do not separately license the checkpoint or explicitly state that the repository's Apache-2.0 license covers trained weights. Consequently RapidRAW does not distribute the checkpoint, an exported ONNX model, or a model download URL. The product capability remains disabled until redistribution rights and the final ONNX hash are documented.
