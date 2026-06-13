//! Feature-gated OpenCV panorama spike surface.
//!
//! This module must stay behind `panorama-opencv-spike` until packaging,
//! notarization, runtime fallback, and validation gates promote it.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenCvPanoramaSpikeReport {
    pub backend_id: &'static str,
    pub crate_version: &'static str,
    pub feature_enabled: bool,
}

pub fn build_spike_report() -> OpenCvPanoramaSpikeReport {
    let _mat_size_probe = std::mem::size_of::<opencv::core::Mat>();

    OpenCvPanoramaSpikeReport {
        backend_id: "opencv-panorama-spike",
        crate_version: env!("CARGO_PKG_VERSION"),
        feature_enabled: true,
    }
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
