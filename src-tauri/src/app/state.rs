use std::sync::Arc;

use image::DynamicImage;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrontendPreviewSessionIdentity {
    pub adjustment_revision: u64,
    pub backend: String,
    pub display_generation: u64,
    pub geometry_revision: u64,
    pub graph_revision: String,
    pub image_session_id: u64,
    pub mask_revision: u64,
    pub patch_revision: u64,
    pub proof_revision: u64,
    pub roi_fingerprint: String,
    pub source_image_path: String,
    pub source_revision: u64,
    pub target_height: u64,
    pub target_width: u64,
    pub viewport_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrontendPreviewOperationIdentity {
    pub generation: u64,
    pub kind: String,
    pub operation_id: u64,
    pub session: FrontendPreviewSessionIdentity,
}

impl FrontendPreviewOperationIdentity {
    pub(crate) fn validate_for_render(
        &self,
        expected_path: &str,
        expected_graph_revision: Option<&str>,
        interactive: bool,
    ) -> Result<(), &'static str> {
        let session = &self.session;
        let expected_kind = if interactive {
            "interactive"
        } else {
            "settled"
        };
        let positive_identity = self.operation_id > 0
            && self.generation > 0
            && session.adjustment_revision > 0
            && session.display_generation > 0
            && session.image_session_id > 0
            && session.source_revision > 0
            && session.target_height > 0
            && session.target_width > 0;
        let graph_matches =
            expected_graph_revision.is_none_or(|revision| revision == session.graph_revision);
        if positive_identity
            && self.kind == expected_kind
            && matches!(session.backend.as_str(), "cpu" | "wgpu")
            && session.source_image_path == expected_path
            && !session.graph_revision.is_empty()
            && !session.roi_fingerprint.is_empty()
            && graph_matches
        {
            Ok(())
        } else {
            Err("invalid_preview_operation_identity")
        }
    }

    #[cfg(test)]
    pub(crate) fn compatibility_identity() -> Self {
        Self {
            generation: 1,
            kind: "settled".to_string(),
            operation_id: 1,
            session: FrontendPreviewSessionIdentity {
                adjustment_revision: 1,
                backend: "cpu".to_string(),
                display_generation: 1,
                geometry_revision: 0,
                graph_revision: "compatibility".to_string(),
                image_session_id: 1,
                mask_revision: 0,
                patch_revision: 0,
                proof_revision: 0,
                roi_fingerprint: "[0,0,1,1]".to_string(),
                source_image_path: "/compatibility/analytics".to_string(),
                source_revision: 1,
                target_height: 1,
                target_width: 1,
                viewport_revision: 0,
            },
        }
    }
}

pub struct PreviewJob {
    pub adjustments: Arc<serde_json::Value>,
    pub expected_image_path: String,
    pub is_interactive: bool,
    pub preview_operation_identity: Box<FrontendPreviewOperationIdentity>,
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
    pub preview_operation_identity: Box<FrontendPreviewOperationIdentity>,
    pub frame_id: AnalyticsFrameId,
    pub image: Arc<DynamicImage>,
    pub products: AnalyticsProducts,
    pub active_waveform_channel: Option<String>,
    pub policy: AnalyticsSamplingPolicy,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AnalyticsJobIdentity {
    pub frame_id: AnalyticsFrameId,
    pub preview_operation_identity: FrontendPreviewOperationIdentity,
}

impl AnalyticsJob {
    pub fn identity(&self) -> AnalyticsJobIdentity {
        AnalyticsJobIdentity {
            frame_id: self.frame_id,
            preview_operation_identity: (*self.preview_operation_identity).clone(),
        }
    }
}

#[derive(Clone)]
pub struct AnalyticsConfig {
    pub path: String,
    pub frame_id: AnalyticsFrameId,
    pub preview_operation_identity: FrontendPreviewOperationIdentity,
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

    pub(crate) fn library(&self) -> &crate::library::runtime_services::LibraryRuntimeServices {
        self.services.library()
    }

    pub(crate) fn editor(&self) -> &std::sync::Arc<crate::app::services::EditorRuntimeService> {
        self.services.editor()
    }

    pub(crate) fn computational(
        &self,
    ) -> &crate::computational::runtime_services::ComputationalRuntimeServices {
        self.services.computational()
    }

    pub(crate) fn export(&self) -> &crate::export::runtime_services::ExportRuntimeServices {
        self.services.export()
    }

    pub(crate) fn film(&self) -> &crate::render::film_runtime_services::FilmRuntimeServices {
        self.services.film()
    }

    pub(crate) fn gpu(&self) -> &crate::gpu::runtime_services::GpuRuntimeServices {
        self.services.gpu()
    }

    pub(crate) fn render(&self) -> &crate::render::runtime_services::RenderRuntimeServices {
        self.services.render()
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontend_preview_operation_identity_round_trips_the_exact_wire_contract() {
        let mut identity = FrontendPreviewOperationIdentity::compatibility_identity();
        identity.operation_id = 29;
        identity.generation = 7;
        identity.session.image_session_id = 11;
        identity.session.source_image_path = "/fixtures/a.raw".to_string();
        identity.session.graph_revision = "graph-exact".to_string();

        let wire = serde_json::to_value(&identity).unwrap();
        assert_eq!(wire["operationId"], 29);
        assert_eq!(wire["session"]["imageSessionId"], 11);
        assert_eq!(wire["session"]["sourceImagePath"], "/fixtures/a.raw");
        assert_eq!(wire["session"]["graphRevision"], "graph-exact");
        assert_eq!(
            serde_json::from_value::<FrontendPreviewOperationIdentity>(wire).unwrap(),
            identity
        );
    }

    #[test]
    fn render_boundary_rejects_kind_source_graph_and_zero_target_mismatches() {
        let identity = FrontendPreviewOperationIdentity::compatibility_identity();
        assert_eq!(
            identity.validate_for_render("/compatibility/analytics", Some("compatibility"), false),
            Ok(())
        );
        assert!(
            identity
                .validate_for_render("/compatibility/analytics", Some("compatibility"), true)
                .is_err()
        );
        assert!(
            identity
                .validate_for_render("/fixtures/b.raw", Some("compatibility"), false)
                .is_err()
        );
        assert!(
            identity
                .validate_for_render("/compatibility/analytics", Some("stale"), false)
                .is_err()
        );
        let mut zero_target = identity;
        zero_target.session.target_width = 0;
        assert!(
            zero_target
                .validate_for_render("/compatibility/analytics", Some("compatibility"), false)
                .is_err()
        );
        let mut empty_roi = FrontendPreviewOperationIdentity::compatibility_identity();
        empty_roi.session.roi_fingerprint.clear();
        assert!(
            empty_roi
                .validate_for_render("/compatibility/analytics", Some("compatibility"), false)
                .is_err()
        );
    }
}
