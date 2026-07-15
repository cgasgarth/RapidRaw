//! GPU capabilities owned by the application service container.
//!
//! The bundle prevents commands and neighboring domains from depending on
//! independently published GPU context, processing, and crash-marker handles.
//! Snapshot methods clone capabilities while service locks are held; callers do
//! rendering, event delivery, filesystem work, and awaits after those locks are
//! released.

use std::sync::Arc;

use crate::app::display_target::DisplayTargetCoordinator;
use crate::gpu::crash_marker_service::{GpuCrashMarkerLease, GpuCrashMarkerService};
use crate::gpu::gpu_context_service::GpuContextService;
use crate::gpu::gpu_display::{PresentationSchedulerReport, WgpuPresentationScheduler};
use crate::gpu::gpu_processing_service::GpuProcessingService;
use crate::gpu::pipeline_registry::GpuPipelineReport;
use crate::image_processing::GpuContext;

#[derive(Clone, Default)]
pub(crate) struct GpuRuntimeServices {
    context: Arc<GpuContextService>,
    processing: Arc<GpuProcessingService>,
    crash_marker: Arc<GpuCrashMarkerService>,
}

impl GpuRuntimeServices {
    pub(crate) fn context(&self) -> &Arc<GpuContextService> {
        &self.context
    }

    pub(crate) fn processing(&self) -> &Arc<GpuProcessingService> {
        &self.processing
    }

    pub(crate) fn configure_crash_marker(&self, path: std::path::PathBuf) {
        self.crash_marker.configure(path);
    }

    pub(crate) fn begin_initialization(&self) -> GpuCrashMarkerLease {
        self.crash_marker.begin_initialization()
    }

    pub(crate) fn context_snapshot(&self) -> Option<GpuContext> {
        self.context.context_snapshot()
    }

    pub(crate) fn coordinator_snapshot(&self) -> Option<Arc<DisplayTargetCoordinator>> {
        self.context.coordinator_snapshot()
    }

    #[cfg(any(test, target_os = "macos", feature = "validation-harness"))]
    pub(crate) fn install_coordinator(
        &self,
        coordinator: Arc<DisplayTargetCoordinator>,
    ) -> Option<GpuContext> {
        self.context.install_coordinator(coordinator)
    }

    pub(crate) fn presentation_snapshot(&self) -> Option<Arc<WgpuPresentationScheduler>> {
        self.context_snapshot()
            .map(|context| Arc::clone(&context.presentation))
    }

    pub(crate) fn presentation_report(&self) -> Option<PresentationSchedulerReport> {
        self.context_snapshot()
            .map(|context| context.presentation.report())
    }

    pub(crate) fn pipeline_report(&self) -> Option<GpuPipelineReport> {
        self.context_snapshot()
            .map(|context| context.pipeline_registry.report())
    }

    pub(crate) fn resize_presentation(&self, width: u32, height: u32) {
        if let Some(presentation) = self.presentation_snapshot() {
            presentation.resize(width, height);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uninitialized_gpu_capability_reports_no_runtime_artifacts() {
        let gpu = GpuRuntimeServices::default();
        assert!(gpu.context_snapshot().is_none());
        assert!(gpu.presentation_snapshot().is_none());
        assert!(gpu.presentation_report().is_none());
        assert!(gpu.pipeline_report().is_none());
    }

    #[test]
    fn clones_share_one_gpu_capability_authority() {
        let gpu = GpuRuntimeServices::default();
        let clone = gpu.clone();
        assert!(Arc::ptr_eq(gpu.context(), clone.context()));
        assert!(Arc::ptr_eq(gpu.processing(), clone.processing()));
    }
}
