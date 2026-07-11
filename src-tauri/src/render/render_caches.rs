use crate::app_state::AppState;
use image::DynamicImage;

pub struct RenderCaches<'a> {
    state: &'a AppState,
}

impl<'a> RenderCaches<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
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
        if let Ok(mut geometry_cache) = self.state.geometry_cache.lock() {
            if geometry_cache.len() > max_entries {
                geometry_cache.clear();
            }
            geometry_cache.insert(key, image);
        }
    }

    pub fn set_decoded_image_cache_capacity(&self, capacity: usize) {
        if let Ok(mut decoded_cache) = self.state.decoded_image_cache.lock() {
            decoded_cache.set_capacity(capacity);
        }
    }

    pub fn clear_image_caches(&self) {
        if let Ok(mut decoded_cache) = self.state.decoded_image_cache.lock() {
            decoded_cache.clear();
        }
        self.clear_gpu_dependent_preview();
    }

    pub fn clear_session_caches(&self) {
        if let Ok(mut patch_cache) = self.state.patch_cache.lock() {
            patch_cache.clear();
        }
        if let Ok(mut mask_cache) = self.state.mask_cache.lock() {
            mask_cache.clear();
        }
        if let Ok(mut geometry_cache) = self.state.geometry_cache.lock() {
            geometry_cache.clear();
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
