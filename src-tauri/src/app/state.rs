use std::sync::Arc;

use image::DynamicImage;
use serde::Serialize;

#[cfg(feature = "ai")]
use crate::ai::ai_processing::{CachedDepthMap, ImageEmbeddings};
#[cfg(feature = "ai")]
use crate::render::native_cache::{CachePolicy, MemoryLruCache};
use crate::source_revision::FingerprintCache;

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
    #[cfg(feature = "ai")]
    pub ai_model_registry: crate::ai::model_registry::AiModelRegistry,
    #[cfg(feature = "ai")]
    pub ai_embeddings: MemoryLruCache<String, ImageEmbeddings>,
    #[cfg(feature = "ai")]
    pub ai_depth_maps: MemoryLruCache<String, CachedDepthMap>,
    export_jobs: crate::export::job_registry::ExportJobRegistry,
    pub(crate) interactive_gpu_pressure:
        Arc<crate::render::interactive_gpu_pressure::InteractiveGpuPressure>,
    image_open_coordinator: crate::image_open_session::ImageOpenCoordinator,
    pub source_fingerprint_cache: Arc<FingerprintCache>,
    pub smart_preview_scheduler:
        Arc<crate::library::smart_preview_scheduler::SmartPreviewScheduler>,
}

impl AppState {
    pub(crate) fn image_open(&self) -> &crate::image_open_session::ImageOpenCoordinator {
        &self.image_open_coordinator
    }

    pub(crate) fn export_jobs(&self) -> &crate::export::job_registry::ExportJobRegistry {
        &self.export_jobs
    }

    pub fn new() -> Self {
        #[cfg(feature = "ai")]
        let mib = 1024_u64 * 1024;
        let services = Arc::new(crate::app::services::AppServices::new());
        #[cfg(feature = "ai")]
        let cache_budget = services.native_caches.budget();
        #[cfg(feature = "ai")]
        let policy =
            |name: &'static str, soft: u64, hard: u64, max_entries: Option<usize>| CachePolicy {
                name,
                soft_limit_bytes: soft * mib,
                hard_limit_bytes: hard * mib,
                max_entries,
            };
        Self {
            services,
            #[cfg(feature = "ai")]
            ai_model_registry: crate::ai::model_registry::AiModelRegistry::new(1536 * 1024 * 1024),
            #[cfg(feature = "ai")]
            ai_embeddings: MemoryLruCache::new(
                policy("ai_embeddings", 256, 384, Some(4)),
                Arc::clone(&cache_budget),
            ),
            #[cfg(feature = "ai")]
            ai_depth_maps: MemoryLruCache::new(
                policy("ai_depth_maps", 128, 192, Some(4)),
                Arc::clone(&cache_budget),
            ),
            export_jobs: crate::export::job_registry::ExportJobRegistry::default(),
            interactive_gpu_pressure: Arc::default(),
            image_open_coordinator: crate::image_open_session::ImageOpenCoordinator::default(),
            source_fingerprint_cache: Arc::new(FingerprintCache::new(64)),
            smart_preview_scheduler:
                crate::library::smart_preview_scheduler::SmartPreviewScheduler::new(64),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
