//! Render and preview capabilities owned by the application service container.
//!
//! The aggregate keeps preview currentness, worker lifecycle, frame caches,
//! analytics, and native render caches behind one domain boundary. Callers clone
//! narrow handles before GPU work, disk I/O, event emission, or awaits.

use std::sync::Arc;

#[derive(Clone, Default)]
pub(crate) struct RenderRuntimeServices {
    preview_runtime: Arc<super::preview_runtime_service::PreviewRuntimeService>,
    preview_frames: Arc<super::preview_frame_cache_service::PreviewFrameCacheService>,
    preview_session: Arc<crate::app::preview_session_service::PreviewSessionService>,
    analytics: Arc<super::analytics_service::AnalyticsRuntimeService>,
    full_warp_cache: Arc<super::full_warp_cache_service::FullWarpCacheService>,
    native_caches: Arc<super::native_cache_service::NativeCacheService>,
    interactive_gpu_pressure: Arc<super::interactive_gpu_pressure::InteractiveGpuPressure>,
}

impl RenderRuntimeServices {
    pub(crate) fn preview_runtime(
        &self,
    ) -> &Arc<super::preview_runtime_service::PreviewRuntimeService> {
        &self.preview_runtime
    }

    pub(crate) fn preview_frames(
        &self,
    ) -> &Arc<super::preview_frame_cache_service::PreviewFrameCacheService> {
        &self.preview_frames
    }

    pub(crate) fn preview_session(
        &self,
    ) -> &Arc<crate::app::preview_session_service::PreviewSessionService> {
        &self.preview_session
    }

    pub(crate) fn analytics(&self) -> &Arc<super::analytics_service::AnalyticsRuntimeService> {
        &self.analytics
    }

    pub(crate) fn full_warp_cache(
        &self,
    ) -> &Arc<super::full_warp_cache_service::FullWarpCacheService> {
        &self.full_warp_cache
    }

    pub(crate) fn native_caches(&self) -> &Arc<super::native_cache_service::NativeCacheService> {
        &self.native_caches
    }

    pub(crate) fn interactive_gpu_pressure(
        &self,
    ) -> &Arc<super::interactive_gpu_pressure::InteractiveGpuPressure> {
        &self.interactive_gpu_pressure
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clones_share_one_render_authority_per_capability() {
        let render = RenderRuntimeServices::default();
        let clone = render.clone();
        assert!(Arc::ptr_eq(
            render.preview_runtime(),
            clone.preview_runtime()
        ));
        assert!(Arc::ptr_eq(
            render.preview_session(),
            clone.preview_session()
        ));
        assert!(Arc::ptr_eq(render.native_caches(), clone.native_caches()));
    }
}
