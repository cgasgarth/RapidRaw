use std::sync::Arc;

use image::DynamicImage;
use serde::Serialize;

pub struct PreviewJob {
    pub adjustments: Arc<serde_json::Value>,
    pub expected_image_path: String,
    pub is_interactive: bool,
    pub target_resolution: Option<u32>,
    pub roi: Option<(f32, f32, f32, f32)>,
    pub compute_waveform: bool,
    pub active_waveform_channel: Option<String>,
    pub viewer_sample_graph_revision: Option<String>,
    pub responder: tokio::sync::oneshot::Sender<crate::preview_scheduler::PreviewCompletion>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsFrameId {
    pub image_session: u64,
    pub preview_generation: u64,
    pub graph_revision: u64,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub struct AnalyticsProducts: u32 {
        const HISTOGRAM = 1 << 0;
        const GAMUT_MASK = 1 << 1;
        const WAVEFORM = 1 << 2;
        const PARADE = 1 << 3;
        const VECTORSCOPE = 1 << 4;
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct AnalyticsSamplingPolicy {
    pub version: u32,
}

#[derive(Debug)]
pub struct AnalyticsJob {
    pub path: String,
    pub frame_id: AnalyticsFrameId,
    pub image: Arc<DynamicImage>,
    pub products: AnalyticsProducts,
    pub active_waveform_channel: Option<String>,
    pub policy: AnalyticsSamplingPolicy,
}

#[derive(Clone)]
pub struct AnalyticsConfig {
    pub path: String,
    pub frame_id: AnalyticsFrameId,
    pub products: AnalyticsProducts,
    pub active_waveform_channel: Option<String>,
    pub(crate) service: Arc<crate::render::analytics_service::AnalyticsRuntimeService>,
}

pub struct AppState {
    /// Narrow service handles are the preferred capability boundary for new commands.
    pub services: Arc<crate::app::services::AppServices>,
}

impl AppState {
    pub fn new() -> Self {
        let services = Arc::new(crate::app::services::AppServices::new());
        Self { services }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
