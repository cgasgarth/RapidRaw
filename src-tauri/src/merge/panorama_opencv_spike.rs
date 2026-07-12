//! Feature-gated OpenCV panorama spike surface.
//!
//! This module must stay behind `panorama-opencv-spike` until packaging,
//! notarization, runtime fallback, and validation gates promote it.

pub use rapidraw_computational::OpenCvPanoramaSpikeReport;

pub fn build_spike_report() -> OpenCvPanoramaSpikeReport {
    rapidraw_computational::require_opencv_panorama_backend()
        .expect("panorama OpenCV module only compiles with its capability enabled");
    rapidraw_computational::build_opencv_panorama_spike_report(env!("CARGO_PKG_VERSION"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencv_spike_links_core_types() {
        let report = build_spike_report();

        assert_eq!(report.backend_id, "opencv-panorama-spike");
        assert!(report.feature_enabled);
        assert!(!report.crate_version.is_empty());
    }
}
