use crate::app_state::AppState;
use image::DynamicImage;
use serde::Serialize;

#[derive(Serialize)]
pub struct NativeCacheReport {
    pub total_known_cpu_cache_bytes: u64,
    pub total_soft_limit_bytes: u64,
    pub total_hard_limit_bytes: u64,
    pub caches: Vec<crate::render::native_cache::CacheStats>,
    pub separately_tracked: &'static str,
}

pub struct RenderCaches<'a> {
    state: &'a AppState,
}

impl<'a> RenderCaches<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub fn native_cache_report(&self) -> NativeCacheReport {
        let (total_soft_limit_bytes, total_hard_limit_bytes) = self.state.cache_budget.limits();
        NativeCacheReport {
            total_known_cpu_cache_bytes: self.state.cache_budget.current_bytes(),
            total_soft_limit_bytes,
            total_hard_limit_bytes,
            caches: vec![
                self.state.geometry_cache.stats(),
                self.state.thumbnail_geometry_cache.stats(),
                self.state.mask_cache.stats(),
                self.state.viewer_sample_frames.stats(),
                self.state.lut_cache.stats(),
                self.state.decoded_image_cache.stats(),
            ],
            separately_tracked: "current-session image/preview slots, GPU textures/buffers, patch JSON",
        }
    }

    pub fn clear_gpu_dependent_preview(&self) {
        self.clear_gpu_image_cache();
        if let Ok(mut preview_cache) = self.state.cached_preview.lock() {
            *preview_cache = None;
        }
        if let Ok(mut warped_cache) = self.state.full_warped_cache.lock() {
            *warped_cache = None;
        }
        if let Ok(mut transformed_cache) = self.state.full_transformed_cache.lock() {
            *transformed_cache = None;
        }
    }

    pub fn clear_gpu_image_cache(&self) {
        if let Ok(mut gpu_cache) = self.state.gpu_image_cache.lock() {
            *gpu_cache = None;
        }
    }

    pub fn clear_stale_gpu_image_cache(
        &self,
        pre_gpu_identity: crate::gpu_processing::PreGpuImageIdentity,
        device_generation: u64,
        width: u32,
        height: u32,
    ) {
        if let Ok(mut gpu_cache) = self.state.gpu_image_cache.lock()
            && let Some(cache) = gpu_cache.as_ref()
            && (cache.pre_gpu_identity != pre_gpu_identity
                || cache.device_generation != device_generation
                || cache.width != width
                || cache.height != height)
        {
            *gpu_cache = None;
        }
    }

    pub fn insert_geometry_cache_entry(&self, key: u64, image: DynamicImage, max_entries: usize) {
        let _ = max_entries;
        self.state
            .geometry_cache
            .insert_weighted(key, std::sync::Arc::new(image));
    }

    pub fn set_decoded_image_cache_capacity(&self, capacity: usize) {
        self.state.decoded_image_cache.set_capacity(capacity);
    }

    pub fn clear_image_caches(&self) {
        self.state.decoded_image_cache.clear();
        self.clear_gpu_dependent_preview();
    }

    pub fn clear_session_caches(&self) {
        if let Ok(mut patch_cache) = self.state.patch_cache.lock() {
            patch_cache.clear();
        }
        self.state.mask_cache.clear();
        self.state.geometry_cache.clear();
        if let Ok(report) = serde_json::to_string(&self.native_cache_report()) {
            log::debug!("native_cache_report={report}");
        }
    }

    pub fn clear_active_image_render_state(&self) {
        if let Ok(mut original_image) = self.state.original_image.lock() {
            *original_image = None;
        }
        self.clear_gpu_dependent_preview();
        self.clear_session_caches();
    }
}
