use std::sync::Arc;

use image::{DynamicImage, GrayImage};
use serde::Serialize;

#[cfg(feature = "ai")]
use crate::ai::ai_processing::{CachedDepthMap, ImageEmbeddings};
use crate::cache_utils::DecodedImageCache;
use crate::lut_processing::{CachedLutPath, Lut};
use crate::render::native_cache::{CacheBudgetCoordinator, CachePolicy, MemoryLruCache};
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
    pub computational_merge_jobs: crate::merge::computational_job::ComputationalMergeJobRegistry,
    pub cache_budget: Arc<CacheBudgetCoordinator>,
    pub lut_cache: MemoryLruCache<String, CachedLutPath>,
    pub lut_content_cache: MemoryLruCache<[u8; 32], Lut>,
    pub(crate) interactive_gpu_pressure:
        Arc<crate::render::interactive_gpu_pressure::InteractiveGpuPressure>,
    pub mask_cache: MemoryLruCache<u64, GrayImage>,
    pub geometry_cache: MemoryLruCache<u64, DynamicImage>,
    pub thumbnail_geometry_cache: MemoryLruCache<String, (u64, Arc<DynamicImage>, f32)>,
    image_open_coordinator: crate::image_open_session::ImageOpenCoordinator,
    pub decoded_image_cache: DecodedImageCache,
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
        let mib = 1024 * 1024;
        let cache_budget = CacheBudgetCoordinator::new(768 * mib, 1024 * mib);
        crate::patch_assets::initialize_patch_asset_cache(Arc::clone(&cache_budget));
        let policy = |name, soft, hard, max_entries| CachePolicy {
            name,
            soft_limit_bytes: soft * mib,
            hard_limit_bytes: hard * mib,
            max_entries,
        };
        Self {
            services: Arc::new(crate::app::services::AppServices::new(Arc::clone(
                &cache_budget,
            ))),
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
            computational_merge_jobs:
                crate::merge::computational_job::ComputationalMergeJobRegistry::default(),
            cache_budget: Arc::clone(&cache_budget),
            lut_cache: MemoryLruCache::new(
                policy("lut_paths", 1, 2, Some(64)),
                Arc::clone(&cache_budget),
            ),
            lut_content_cache: MemoryLruCache::new(
                policy("lut_cpu", 64, 96, Some(32)),
                Arc::clone(&cache_budget),
            ),
            interactive_gpu_pressure: Arc::default(),
            mask_cache: MemoryLruCache::new(
                policy("masks", 96, 128, Some(64)),
                Arc::clone(&cache_budget),
            ),
            geometry_cache: MemoryLruCache::new(
                policy("geometry", 256, 384, Some(16)),
                Arc::clone(&cache_budget),
            ),
            thumbnail_geometry_cache: MemoryLruCache::new(
                policy("thumbnail_geometry", 192, 256, Some(96)),
                Arc::clone(&cache_budget),
            ),
            image_open_coordinator: crate::image_open_session::ImageOpenCoordinator::default(),
            decoded_image_cache: DecodedImageCache::new(5, Arc::clone(&cache_budget)),
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
