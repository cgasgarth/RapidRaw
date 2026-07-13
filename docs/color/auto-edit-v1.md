# Auto Edit v1 process boundary

`auto_edit_v1` is the default editor Auto workflow. It analyzes a bounded f32 technical image in its declared scene domain, returns confidence-gated group recommendations, previews without history mutation, and applies the accepted subset with one receipt-backed history transaction.

`legacy_auto_adjust_v1` preserves the previous `calculate_auto_adjustments` output for saved automation and existing batch callers. Its behavior is intentionally frozen: a 1024-pixel RGB8 analysis image, a 256-bin Rec.709-code-value luma histogram, fixed thresholds, a second RGB8 neutral estimator, and Basic/Color/Effects output keys including Clarity, Dehaze, Vignette, and Centré. A native golden assertion locks its exact JSON envelope.

No saved sidecar is reinterpreted. Existing explicit callers can use `calculate_legacy_auto_adjustments_v1`; new editor proposals carry `rapidraw.auto_edit.v1`, implementation version, source/decode/WB/geometry identities, per-group evidence and confidence, and a separate application receipt.

Auto Edit analysis is independent of display profile, proof overlay, theme, monitor, and zoom. Sensor clipping and reconstruction remain unknown unless an authoritative RAW receipt supplies them; the analyzer does not infer either from display code values. Detail and Geometry abstain until their dedicated services are available, and Atmosphere is enabled only through the dedicated haze analysis capability.
