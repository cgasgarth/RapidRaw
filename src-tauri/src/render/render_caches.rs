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
        let (total_known_cpu_cache_bytes, limits) =
            self.state.services.native_caches.budget_usage();
        let (total_soft_limit_bytes, total_hard_limit_bytes) = limits;
        let mut caches = self.state.services.native_caches.stats();
        caches.push(self.state.services.viewer_sampling.stats());
        if let Some(patch_stats) = crate::patch_assets::patch_asset_cache_stats() {
            caches.extend(patch_stats);
        }
        NativeCacheReport {
            total_known_cpu_cache_bytes,
            total_soft_limit_bytes,
            total_hard_limit_bytes,
            caches,
            separately_tracked: "current-session image/preview slots, GPU textures/buffers, patch JSON",
        }
    }

    pub fn clear_gpu_dependent_preview(&self) {
        self.clear_display_encoded_artifacts();
        self.state.services.preview_frames.clear();
        self.state.services.full_warp_cache.clear_frame();
    }

    /// Drops only artifacts whose pixels/resources depend on the GPU device generation.
    /// Decoded and other CPU source-domain artifacts remain reusable.
    pub fn clear_backend_generation_artifacts(&self) {
        self.clear_gpu_dependent_preview();
    }

    /// Drops display/view-output frames without invalidating decoded or scene-linear inputs.
    pub fn clear_display_encoded_artifacts(&self) {
        self.state.services.viewer_sampling.clear_frames();
        self.clear_gpu_image_cache();
    }

    pub fn clear_gpu_image_cache(&self) {
        self.state.services.gpu_processing.clear_input();
    }

    pub fn insert_geometry_cache_entry(&self, key: u64, image: DynamicImage, max_entries: usize) {
        let _ = max_entries;
        self.state
            .services
            .native_caches
            .insert_geometry(key, std::sync::Arc::new(image));
    }

    pub fn set_decoded_image_cache_capacity(&self, capacity: usize) {
        self.state
            .services
            .native_caches
            .set_decoded_capacity(capacity);
    }

    pub fn clear_image_caches(&self) {
        self.state.services.native_caches.clear_decoded();
        self.clear_backend_generation_artifacts();
    }

    pub fn clear_session_caches(&self) {
        crate::patch_assets::clear_patch_asset_cache();
        self.state.services.payload_residency.clear();
        self.state
            .services
            .native_caches
            .clear_session_derivatives();
        self.state.services.viewer_sampling.clear_frames();
        if let Ok(report) = serde_json::to_string(&self.native_cache_report()) {
            log::debug!("native_cache_report={report}");
        }
    }

    pub fn clear_active_image_render_state(&self) {
        self.state.services.editor.clear_image();
        self.state.services.full_warp_cache.clear_session();
        self.state.services.viewer_sampling.clear_session();
        self.clear_gpu_dependent_preview();
        self.clear_session_caches();
    }

    /// Canonical Reset invalidates every edit/session-derived artifact. Source decode remains a
    /// separate domain and may be retained when the caller keeps the active source loaded.
    pub fn clear_canonical_reset_artifacts(&self) {
        self.clear_active_image_render_state();
        self.state.services.native_caches.clear_thumbnail_geometry();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_invalidation_preserves_scene_and_decode_domains() {
        let state = AppState::new();
        state
            .services
            .native_caches
            .insert_geometry(7, std::sync::Arc::new(DynamicImage::new_rgb8(2, 2)));
        let before = state.services.native_caches.geometry(7).is_some();
        RenderCaches::new(&state).clear_display_encoded_artifacts();
        assert_eq!(state.services.native_caches.geometry(7).is_some(), before);
    }
}
