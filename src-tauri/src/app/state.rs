use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::{Arc, Mutex};

use image::{DynamicImage, GenericImageView, GrayImage};
use serde::{Deserialize, Serialize};
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use wgpu::{Texture, TextureView};

use crate::ai::ai_processing::{CachedDepthMap, ImageEmbeddings};
use crate::cache_utils::DecodedImageCache;
use crate::gpu_processing::GpuProcessor;
use crate::image_processing::GpuContext;
use crate::lens_correction::LensDatabase;
use crate::lut_processing::{CachedLutPath, Lut};
use crate::panorama_stitching::PendingPanoramaResult;
use crate::render::native_cache::{CacheBudgetCoordinator, CachePolicy, MemoryLruCache};
use crate::source_revision::FingerprintCache;
use crate::tethering::TetherSessionSnapshot;

#[derive(Serialize, Deserialize)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
    pub fullscreen: bool,
}

#[derive(Clone)]
pub struct LoadedImage {
    pub path: String,
    pub image: Arc<DynamicImage>,
    pub is_raw: bool,
    pub artifact_source: crate::render::artifact_identity::SourceArtifactIdentity,
}

#[derive(Clone)]
pub struct CachedPreview {
    pub image: Arc<DynamicImage>,
    pub small_image: Arc<DynamicImage>,
    pub identity: crate::render::artifact_identity::RenderArtifactIdentity,
    pub scale: f32,
    pub unscaled_crop_offset: (f32, f32),
    pub preview_dim: u32,
    pub interactive_divisor: f32,
}

#[derive(Clone)]
pub enum SampleablePixels {
    Native(Arc<DynamicImage>),
}

impl SampleablePixels {
    pub fn native(image: Arc<DynamicImage>) -> Self {
        Self::Native(image)
    }

    pub fn image(&self) -> &Arc<DynamicImage> {
        match self {
            Self::Native(image) => image,
        }
    }

    pub fn dimensions(&self) -> (u32, u32) {
        self.image().dimensions()
    }

    pub fn retained_bytes(&self) -> u64 {
        self.image().as_bytes().len() as u64
    }
}

#[derive(Clone)]
pub struct CachedViewerSampleFrame {
    pub artifact_identity: crate::render::artifact_identity::RenderArtifactIdentity,
    pub graph_revision: String,
    pub pixels: SampleablePixels,
    pub image_identity: String,
    pub space_label: String,
}

pub struct GpuImageCache {
    pub texture: Texture,
    pub texture_view: TextureView,
    pub width: u32,
    pub height: u32,
    pub pre_gpu_identity: crate::gpu_processing::PreGpuImageIdentity,
    pub device_generation: u64,
}

pub struct GpuProcessorState {
    pub processor: GpuProcessor,
    pub width: u32,
    pub height: u32,
}

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
    pub scheduler: Arc<crate::analytics_scheduler::AnalyticsScheduler>,
}

#[derive(Clone)]
pub struct PendingHdrSourceRef {
    pub content_hash: String,
    pub image_path: String,
    pub width: u32,
    pub height: u32,
    pub exposure_time_seconds: f32,
    pub iso: f32,
    pub source_index: usize,
}

#[derive(Clone)]
pub struct PendingHdrMergePlan {
    pub accepted_dry_run_plan_hash: String,
    pub accepted_dry_run_plan_id: String,
    pub alignment_policy_id: String,
    pub source_content_hashes: Vec<String>,
    pub source_paths: Vec<String>,
    pub static_radiance_hash: Option<String>,
    pub deghost_radiance_hash: Option<String>,
    pub motion_probability_hash: Option<String>,
    pub ownership_hash: Option<String>,
    pub feather_hash: Option<String>,
    pub unresolved_fraction: Option<f32>,
    pub output_width: u64,
    pub output_height: u64,
    pub(crate) planned_sources: Vec<crate::merge::hdr::PlannedSource>,
    pub(crate) motion_probability_bytes: Vec<u8>,
    pub(crate) ownership_bytes: Vec<u8>,
    pub(crate) feather_bytes: Vec<u8>,
    pub scene_linear_artifact_hash: Option<String>,
    pub tone_mapped_preview_hash: Option<String>,
    pub motion_coverage: Option<f32>,
    pub confidence_mean: Option<f32>,
}

pub struct ThumbnailProgressTracker {
    pub total: usize,
    pub completed: usize,
}

pub struct ExportJob {
    pub job_id: String,
    pub cancellation_token: Arc<AtomicBool>,
    pub cancellation_notify: Arc<Notify>,
    pub task_handle: Option<JoinHandle<()>>,
}

pub struct ImportJob {
    pub job_id: String,
    pub cancellation_token: Arc<AtomicBool>,
    pub task_handle: Option<tauri::async_runtime::JoinHandle<()>>,
}

pub struct TransformedImageCache {
    pub identity: crate::render::artifact_identity::RenderArtifactIdentity,
    pub image: Arc<DynamicImage>,
    pub offset: (f32, f32),
}

pub struct WarpedImageCache {
    pub identity: crate::render::artifact_identity::RenderArtifactIdentity,
    pub image: Arc<DynamicImage>,
}

pub struct AppState {
    pub window_setup_complete: AtomicBool,
    pub gpu_crash_flag_path: Mutex<Option<PathBuf>>,
    pub original_image: Mutex<Option<LoadedImage>>,
    pub cached_preview: Mutex<Option<CachedPreview>>,
    pub gpu_context: Mutex<Option<GpuContext>>,
    pub gpu_image_cache: Mutex<Option<GpuImageCache>>,
    pub gpu_processor: Mutex<Option<GpuProcessorState>>,
    pub ai_model_registry: crate::ai::model_registry::AiModelRegistry,
    pub ai_embeddings: Mutex<Option<ImageEmbeddings>>,
    pub ai_depth_map: Mutex<Option<CachedDepthMap>>,
    pub export_job: Mutex<Option<ExportJob>>,
    pub import_job: Mutex<Option<ImportJob>>,
    pub computational_merge_jobs: crate::merge::computational_job::ComputationalMergeJobRegistry,
    pub hdr_result: Arc<Mutex<Option<DynamicImage>>>,
    pub hdr_runtime_plan: Arc<Mutex<Option<PendingHdrMergePlan>>>,
    pub hdr_plan_generation: Arc<AtomicUsize>,
    pub hdr_source_refs: Arc<Mutex<Vec<PendingHdrSourceRef>>>,
    pub focus_stack_plan_generation: Arc<AtomicUsize>,
    pub focus_stack_runtime_plan: Arc<Mutex<Option<(String, String)>>>,
    pub focus_stack_accepted_runtime:
        Arc<Mutex<Option<crate::merge::focus_stack::job::AcceptedFocusRuntime>>>,
    pub focus_stack_job_results: crate::merge::focus_stack::job::FocusStackJobResults,
    pub burst_sr_accepted_runtime:
        Arc<Mutex<Option<crate::merge::super_resolution::job::AcceptedBurstSrRuntime>>>,
    pub burst_sr_job_results: crate::merge::super_resolution::job::BurstSrJobResults,
    pub panorama_result: Arc<Mutex<Option<PendingPanoramaResult>>>,
    pub denoise_result: Arc<Mutex<Option<DynamicImage>>>,
    pub indexing_task_handle: Mutex<Option<JoinHandle<()>>>,
    pub cache_budget: Arc<CacheBudgetCoordinator>,
    pub lut_cache: MemoryLruCache<String, CachedLutPath>,
    pub lut_content_cache: MemoryLruCache<[u8; 32], Lut>,
    pub initial_file_path: Mutex<Option<String>>,
    pub thumbnail_cancellation_token: Arc<AtomicBool>,
    pub thumbnail_progress: Mutex<ThumbnailProgressTracker>,
    pub preview_scheduler: Mutex<Option<Arc<crate::preview_scheduler::PreviewScheduler>>>,
    pub export_interactive_gpu_waiters: Arc<AtomicUsize>,
    pub viewer_sample_frames: MemoryLruCache<String, CachedViewerSampleFrame>,
    pub analytics_scheduler: Mutex<Option<Arc<crate::analytics_scheduler::AnalyticsScheduler>>>,
    pub mask_cache: MemoryLruCache<u64, GrayImage>,
    pub payload_residency_cache: Mutex<HashMap<String, serde_json::Value>>,
    pub geometry_cache: MemoryLruCache<u64, DynamicImage>,
    pub thumbnail_geometry_cache: MemoryLruCache<String, (u64, Arc<DynamicImage>, f32)>,
    pub lens_db: Mutex<Option<Arc<LensDatabase>>>,
    pub load_image_generation: Arc<AtomicUsize>,
    pub image_open_coordinator: crate::image_open_session::ImageOpenCoordinator,
    pub full_warped_cache: Mutex<Option<WarpedImageCache>>,
    pub full_transformed_cache: Mutex<Option<TransformedImageCache>>,
    pub decoded_image_cache: DecodedImageCache,
    pub source_fingerprint_cache: Arc<FingerprintCache>,
    pub thumbnail_scheduler: Arc<crate::library::thumbnail_scheduler::ThumbnailScheduler>,
    pub smart_preview_scheduler:
        Arc<crate::library::smart_preview_scheduler::SmartPreviewScheduler>,
    pub tether_session: Mutex<Option<TetherSessionSnapshot>>,
}

impl AppState {
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
            window_setup_complete: AtomicBool::new(false),
            gpu_crash_flag_path: Mutex::new(None),
            original_image: Mutex::new(None),
            cached_preview: Mutex::new(None),
            gpu_context: Mutex::new(None),
            gpu_image_cache: Mutex::new(None),
            gpu_processor: Mutex::new(None),
            ai_model_registry: crate::ai::model_registry::AiModelRegistry::new(1536 * 1024 * 1024),
            ai_embeddings: Mutex::new(None),
            ai_depth_map: Mutex::new(None),
            export_job: Mutex::new(None),
            import_job: Mutex::new(None),
            computational_merge_jobs:
                crate::merge::computational_job::ComputationalMergeJobRegistry::default(),
            hdr_result: Arc::new(Mutex::new(None)),
            hdr_runtime_plan: Arc::new(Mutex::new(None)),
            hdr_plan_generation: Arc::new(AtomicUsize::new(0)),
            hdr_source_refs: Arc::new(Mutex::new(Vec::new())),
            focus_stack_plan_generation: Arc::new(AtomicUsize::new(0)),
            focus_stack_runtime_plan: Arc::new(Mutex::new(None)),
            focus_stack_accepted_runtime: Arc::new(Mutex::new(None)),
            focus_stack_job_results: crate::merge::focus_stack::job::FocusStackJobResults::default(
            ),
            burst_sr_accepted_runtime: Arc::new(Mutex::new(None)),
            burst_sr_job_results: crate::merge::super_resolution::job::BurstSrJobResults::default(),
            panorama_result: Arc::new(Mutex::new(None)),
            denoise_result: Arc::new(Mutex::new(None)),
            indexing_task_handle: Mutex::new(None),
            cache_budget: Arc::clone(&cache_budget),
            lut_cache: MemoryLruCache::new(
                policy("lut_paths", 1, 2, Some(64)),
                Arc::clone(&cache_budget),
            ),
            lut_content_cache: MemoryLruCache::new(
                policy("lut_cpu", 64, 96, Some(32)),
                Arc::clone(&cache_budget),
            ),
            initial_file_path: Mutex::new(None),
            thumbnail_cancellation_token: Arc::new(AtomicBool::new(false)),
            thumbnail_progress: Mutex::new(ThumbnailProgressTracker {
                total: 0,
                completed: 0,
            }),
            preview_scheduler: Mutex::new(None),
            export_interactive_gpu_waiters: Arc::new(AtomicUsize::new(0)),
            viewer_sample_frames: MemoryLruCache::new(
                policy("viewer_samples", 96, 128, Some(8)),
                Arc::clone(&cache_budget),
            ),
            analytics_scheduler: Mutex::new(None),
            mask_cache: MemoryLruCache::new(
                policy("masks", 96, 128, Some(64)),
                Arc::clone(&cache_budget),
            ),
            payload_residency_cache: Mutex::new(HashMap::new()),
            geometry_cache: MemoryLruCache::new(
                policy("geometry", 256, 384, Some(16)),
                Arc::clone(&cache_budget),
            ),
            thumbnail_geometry_cache: MemoryLruCache::new(
                policy("thumbnail_geometry", 192, 256, Some(96)),
                Arc::clone(&cache_budget),
            ),
            lens_db: Mutex::new(None),
            load_image_generation: Arc::new(AtomicUsize::new(0)),
            image_open_coordinator: crate::image_open_session::ImageOpenCoordinator::default(),
            full_warped_cache: Mutex::new(None),
            full_transformed_cache: Mutex::new(None),
            decoded_image_cache: DecodedImageCache::new(5, Arc::clone(&cache_budget)),
            source_fingerprint_cache: Arc::new(FingerprintCache::new(64)),
            thumbnail_scheduler: crate::library::thumbnail_scheduler::ThumbnailScheduler::new(
                Default::default(),
            ),
            smart_preview_scheduler:
                crate::library::smart_preview_scheduler::SmartPreviewScheduler::new(64),
            tether_session: Mutex::new(None),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
