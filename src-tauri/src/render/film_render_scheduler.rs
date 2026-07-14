//! Revision-aware quality scheduling boundary for Film preview/export requests.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FilmRenderQualityV1 {
    InteractiveDragV1,
    SettledPreviewV1,
    ExportFullV1,
    ProfileThumbnailV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FilmRenderIdentityV1 {
    pub source_content_sha256: String,
    pub selected_image_id: String,
    pub graph_revision: u64,
    pub upstream_graph_sha256: String,
    pub film_node_sha256: String,
    pub compiled_profile_sha256: String,
    pub execution_plan_sha256: String,
    pub orientation_and_geometry_sha256: String,
    pub full_resolution_coordinate_policy: String,
    pub quality: FilmRenderQualityV1,
    pub view_output_sha256: String,
    pub crop_and_dimensions_sha256: String,
}

pub(crate) fn can_commit(current: &FilmRenderIdentityV1, result: &FilmRenderIdentityV1) -> bool {
    current == result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(quality: FilmRenderQualityV1) -> FilmRenderIdentityV1 {
        FilmRenderIdentityV1 {
            source_content_sha256: "sha256:source".into(),
            selected_image_id: "image-1".into(),
            graph_revision: 4,
            upstream_graph_sha256: "fnv1a64:1111111111111111".into(),
            film_node_sha256: "fnv1a64:2222222222222222".into(),
            compiled_profile_sha256: "sha256:profile".into(),
            execution_plan_sha256: "sha256:plan".into(),
            orientation_and_geometry_sha256: "fnv1a64:3333333333333333".into(),
            full_resolution_coordinate_policy: "source_stable_v1".into(),
            quality,
            view_output_sha256: "fnv1a64:4444444444444444".into(),
            crop_and_dimensions_sha256: "fnv1a64:5555555555555555".into(),
        }
    }

    #[test]
    fn rejects_out_of_order_quality_result() {
        assert!(!can_commit(
            &identity(FilmRenderQualityV1::SettledPreviewV1),
            &identity(FilmRenderQualityV1::InteractiveDragV1)
        ));
    }

    #[test]
    fn accepts_exact_revision_identity_only() {
        let current = identity(FilmRenderQualityV1::ExportFullV1);
        assert!(can_commit(&current, &current));
        let mut stale = current.clone();
        stale.graph_revision += 1;
        assert!(!can_commit(&current, &stale));
    }
}
