use std::sync::Arc;

use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::AppState;
use crate::app::commands::preset_previews::render_preset_preview_bytes;
use crate::render::film_look_render::normalize_film_look_adjustments_for_render;
use crate::render::film_render_scheduler::{FilmRenderIdentityV1, FilmRenderQualityV1};
use crate::render::film_thumbnail_cache::{
    FilmThumbnailCacheLookupResult, FilmThumbnailDescriptor, FilmThumbnailEntry,
    FilmThumbnailLookup, sha256_prefixed,
};

const FILM_THUMBNAIL_RENDERER_VERSION: &str = "film-thumbnail-renderer-v1";
const THUMBNAIL_QUALITY: &str = "profile_thumbnail_v1";
const FILM_CONTROLLED_FIELDS: &[&str] = &[
    "temperature",
    "contrast",
    "highlights",
    "shadows",
    "blacks",
    "saturation",
    "glowAmount",
    "grainAmount",
    "grainRoughness",
    "grainSize",
    "halationAmount",
    "filmLookId",
    "filmLookStrength",
    "filmEmulation",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FilmThumbnailRequestV1 {
    request_id: String,
    selected_image_id: String,
    graph_revision: u64,
    look_id: String,
    adjustments: serde_json::Value,
    width: u32,
    height: u32,
    view_output_sha256: String,
    pinned: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum FilmThumbnailStatusV1 {
    Ready,
    Stale,
    Cancelled,
    Unavailable,
    Error,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilmThumbnailResultV1 {
    request_id: String,
    status: FilmThumbnailStatusV1,
    quality: &'static str,
    backend: &'static str,
    cache_status: &'static str,
    key: Option<String>,
    payload_sha256: Option<String>,
    payload_bytes: Option<usize>,
    data_url: Option<String>,
    width: u32,
    height: u32,
    renderer_version: &'static str,
    approximation_codes: Vec<&'static str>,
    elapsed_ms: f64,
    rejection_reason: Option<String>,
}

impl FilmThumbnailResultV1 {
    fn terminal(
        request_id: String,
        status: FilmThumbnailStatusV1,
        width: u32,
        height: u32,
        rejection_reason: impl Into<String>,
    ) -> Self {
        Self {
            request_id,
            status,
            quality: THUMBNAIL_QUALITY,
            backend: "none",
            cache_status: "not_admitted",
            key: None,
            payload_sha256: None,
            payload_bytes: None,
            data_url: None,
            width,
            height,
            renderer_version: FILM_THUMBNAIL_RENDERER_VERSION,
            approximation_codes: Vec::new(),
            elapsed_ms: 0.0,
            rejection_reason: Some(rejection_reason.into()),
        }
    }

    fn ready(
        request_id: String,
        descriptor: &FilmThumbnailDescriptor,
        payload: &[u8],
        cache_status: &'static str,
    ) -> Self {
        Self {
            request_id,
            status: FilmThumbnailStatusV1::Ready,
            quality: THUMBNAIL_QUALITY,
            backend: "gpu",
            cache_status,
            key: Some(descriptor.key.clone()),
            payload_sha256: Some(descriptor.payload_sha256.clone()),
            payload_bytes: Some(payload.len()),
            data_url: Some(format!(
                "data:image/jpeg;base64,{}",
                general_purpose::STANDARD.encode(payload)
            )),
            width: descriptor.width,
            height: descriptor.height,
            renderer_version: FILM_THUMBNAIL_RENDERER_VERSION,
            approximation_codes: vec!["bounded_card_crop_v1"],
            elapsed_ms: 0.0,
            rejection_reason: None,
        }
    }
}

#[tauri::command]
pub(crate) async fn render_film_profile_thumbnail(
    request: FilmThumbnailRequestV1,
    app_handle: tauri::AppHandle,
) -> Result<FilmThumbnailResultV1, String> {
    let started = std::time::Instant::now();
    let worker_handle = app_handle.clone();
    let mut result = tauri::async_runtime::spawn_blocking(move || {
        let state = worker_handle.state::<AppState>();
        render_film_profile_thumbnail_blocking(request, state, worker_handle.clone())
    })
    .await
    .map_err(|error| format!("film_thumbnail_worker_join_failed:{error}"))??;
    result.elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
    Ok(result)
}

fn render_film_profile_thumbnail_blocking(
    request: FilmThumbnailRequestV1,
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<FilmThumbnailResultV1, String> {
    validate_request(&request)?;
    let Some(source) = state.editor().image_snapshot() else {
        return Ok(FilmThumbnailResultV1::terminal(
            request.request_id,
            FilmThumbnailStatusV1::Unavailable,
            request.width,
            request.height,
            "film_thumbnail_source_unavailable",
        ));
    };
    let source_fingerprint = source.artifact_source.source_fingerprint();
    let identity = build_identity(&request, source_fingerprint)?;
    let key = thumbnail_key(&identity, &request.look_id)?;
    let expected = FilmThumbnailLookup {
        key: key.clone(),
        width: request.width,
        height: request.height,
        renderer_version: FILM_THUMBNAIL_RENDERER_VERSION.to_string(),
        output_identity: request.view_output_sha256.clone(),
    };
    let disk_root = app_handle
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("film-thumbnails-v1");
    let lease = state.film().begin(
        request.request_id.clone(),
        thumbnail_lane(&request),
        identity,
    )?;
    let mut prior_rejection = None;
    let cache_lookup = match state.film().thumbnail(&expected, &disk_root) {
        Ok(lookup) => lookup,
        Err(error) => {
            let _ = state.film().finish(&lease);
            return Err(error);
        }
    };
    match cache_lookup {
        FilmThumbnailCacheLookupResult::Hit(entry) => {
            if !state.film().claim_current(&lease) {
                return Ok(FilmThumbnailResultV1::terminal(
                    request.request_id,
                    FilmThumbnailStatusV1::Stale,
                    request.width,
                    request.height,
                    "film_thumbnail_cache_hit_stale",
                ));
            }
            let _ = state.film().set_thumbnail_pinned(&key, request.pinned);
            return Ok(FilmThumbnailResultV1::ready(
                request.request_id,
                &entry.descriptor,
                entry.payload.as_slice(),
                "hit",
            ));
        }
        FilmThumbnailCacheLookupResult::Rejected(reason) => {
            prior_rejection = Some(format!("{reason:?}"));
        }
        FilmThumbnailCacheLookupResult::Miss => {}
    }

    let runtime = state.film().clone();
    let cancellation_lease = lease.clone();
    let editor = Arc::clone(state.editor());
    let cancellation = || {
        if cancellation_lease.is_cancelled() || !runtime.is_current(&cancellation_lease) {
            return Err("film_thumbnail_cancelled".to_string());
        }
        if editor.image_snapshot().is_none_or(|current| {
            current.artifact_source.source_fingerprint() != source_fingerprint
        }) {
            return Err("film_thumbnail_source_superseded".to_string());
        }
        Ok(())
    };

    let payload = match render_preset_preview_bytes(
        request.adjustments,
        &state,
        &app_handle,
        None,
        request.width.max(request.height).max(64),
        Some((request.width, request.height)),
        Some(&cancellation),
    ) {
        Ok(payload) => payload,
        Err(error) if error == "film_thumbnail_cancelled" => {
            let _ = state.film().finish(&lease);
            return Ok(FilmThumbnailResultV1::terminal(
                request.request_id,
                FilmThumbnailStatusV1::Cancelled,
                request.width,
                request.height,
                error,
            ));
        }
        Err(error) if error == "film_thumbnail_source_superseded" => {
            let _ = state.film().finish(&lease);
            return Ok(FilmThumbnailResultV1::terminal(
                request.request_id,
                FilmThumbnailStatusV1::Stale,
                request.width,
                request.height,
                error,
            ));
        }
        Err(error) => {
            let _ = state.film().finish(&lease);
            return Ok(FilmThumbnailResultV1::terminal(
                request.request_id,
                FilmThumbnailStatusV1::Error,
                request.width,
                request.height,
                error,
            ));
        }
    };
    if !state.film().claim_current(&lease) {
        return Ok(FilmThumbnailResultV1::terminal(
            request.request_id,
            FilmThumbnailStatusV1::Stale,
            request.width,
            request.height,
            "film_thumbnail_publication_stale",
        ));
    }
    let descriptor = FilmThumbnailDescriptor {
        key,
        payload_sha256: sha256_prefixed(&payload),
        width: request.width,
        height: request.height,
        renderer_version: FILM_THUMBNAIL_RENDERER_VERSION.to_string(),
        output_identity: request.view_output_sha256,
    };
    let entry = FilmThumbnailEntry {
        descriptor: descriptor.clone(),
        payload: Arc::new(payload),
        pinned: request.pinned,
    };
    state.film().publish_thumbnail(entry.clone(), &disk_root)?;
    let mut result = FilmThumbnailResultV1::ready(
        request.request_id,
        &descriptor,
        entry.payload.as_slice(),
        "miss_rendered",
    );
    result.rejection_reason = prior_rejection;
    Ok(result)
}

fn thumbnail_lane(request: &FilmThumbnailRequestV1) -> String {
    format!(
        "thumbnail:{}:{}x{}",
        request.look_id, request.width, request.height
    )
}

#[tauri::command]
pub(crate) fn cancel_film_profile_thumbnail(
    request_id: String,
    state: tauri::State<AppState>,
) -> bool {
    state.film().cancel(&request_id)
}

#[tauri::command]
pub(crate) fn release_film_profile_thumbnail(key: String, state: tauri::State<AppState>) -> bool {
    let released = state.film().set_thumbnail_pinned(&key, false);
    if released {
        state.film().handle_memory_pressure();
    }
    released
}

#[tauri::command]
pub(crate) fn handle_film_thumbnail_memory_pressure(state: tauri::State<AppState>) {
    state.film().handle_memory_pressure();
}

fn validate_request(request: &FilmThumbnailRequestV1) -> Result<(), String> {
    if request.request_id.trim().is_empty()
        || request.selected_image_id.trim().is_empty()
        || request.look_id.trim().is_empty()
        || request.width < 32
        || request.height < 32
        || request.width > 1024
        || request.height > 1024
        || !is_identity_hash(&request.view_output_sha256)
        || !request.adjustments.is_object()
        || request
            .adjustments
            .get("filmLookId")
            .and_then(serde_json::Value::as_str)
            != Some(request.look_id.as_str())
    {
        return Err("film_thumbnail_invalid_request".to_string());
    }
    Ok(())
}

fn build_identity(
    request: &FilmThumbnailRequestV1,
    source_fingerprint: u64,
) -> Result<FilmRenderIdentityV1, String> {
    let mut upstream = request.adjustments.clone();
    if let Some(object) = upstream.as_object_mut() {
        for field in FILM_CONTROLLED_FIELDS {
            object.remove(*field);
        }
    }
    let normalized = normalize_film_look_adjustments_for_render(&request.adjustments);
    let film_node = FILM_CONTROLLED_FIELDS
        .iter()
        .filter_map(|field| {
            normalized
                .get(*field)
                .map(|value| ((*field).to_string(), value.clone()))
        })
        .collect::<serde_json::Map<_, _>>();
    let geometry = serde_json::json!({
        "crop": request.adjustments.get("crop"),
        "flipHorizontal": request.adjustments.get("flipHorizontal"),
        "flipVertical": request.adjustments.get("flipVertical"),
        "orientationSteps": request.adjustments.get("orientationSteps"),
        "rotation": request.adjustments.get("rotation"),
    });
    Ok(FilmRenderIdentityV1 {
        source_content_sha256: sha256_json(&format!("source-fingerprint:{source_fingerprint}"))?,
        selected_image_id: request.selected_image_id.clone(),
        graph_revision: request.graph_revision,
        upstream_graph_sha256: sha256_json(&upstream)?,
        film_node_sha256: sha256_json(&film_node)?,
        compiled_profile_sha256: sha256_json(&request.look_id)?,
        execution_plan_sha256: sha256_json(&serde_json::json!({
            "quality": THUMBNAIL_QUALITY,
            "rendererVersion": FILM_THUMBNAIL_RENDERER_VERSION,
        }))?,
        orientation_and_geometry_sha256: sha256_json(&geometry)?,
        full_resolution_coordinate_policy: "source_stable_v1".to_string(),
        quality: FilmRenderQualityV1::ProfileThumbnailV1,
        view_output_sha256: request.view_output_sha256.clone(),
        crop_and_dimensions_sha256: sha256_json(&serde_json::json!({
            "crop": request.adjustments.get("crop"),
            "width": request.width,
            "height": request.height,
        }))?,
    })
}

fn thumbnail_key(identity: &FilmRenderIdentityV1, look_id: &str) -> Result<String, String> {
    sha256_json(&serde_json::json!({
        "identity": identity,
        "lookId": look_id,
        "thumbnailRendererVersion": FILM_THUMBNAIL_RENDERER_VERSION,
    }))
}

fn sha256_json(value: &impl Serialize) -> Result<String, String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
}

fn is_identity_hash(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
        || value
            .strip_prefix("fnv1a64:")
            .is_some_and(|hex| hex.len() == 16 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> FilmThumbnailRequestV1 {
        FilmThumbnailRequestV1 {
            request_id: "request-1".into(),
            selected_image_id: "editor-image-session:1".into(),
            graph_revision: 7,
            look_id: "film_look.generic.warm_print.v1".into(),
            adjustments: serde_json::json!({
                "contrast": 10,
                "filmLookId": "film_look.generic.warm_print.v1",
                "filmLookStrength": 65,
                "temperature": 8,
                "exposure": 0.5,
                "crop": {"x": 0, "y": 0, "width": 1, "height": 1}
            }),
            width: 160,
            height: 96,
            view_output_sha256: format!("sha256:{}", "a".repeat(64)),
            pinned: false,
        }
    }

    #[test]
    fn output_identity_only_changes_display_thumbnail_key_not_prefilm_identity() {
        let first = request();
        let first_identity = build_identity(&first, 99).unwrap();
        let mut changed = request();
        changed.view_output_sha256 = format!("sha256:{}", "b".repeat(64));
        let changed_identity = build_identity(&changed, 99).unwrap();
        assert_eq!(
            first_identity.source_content_sha256,
            changed_identity.source_content_sha256
        );
        assert_eq!(
            first_identity.upstream_graph_sha256,
            changed_identity.upstream_graph_sha256
        );
        assert_eq!(
            first_identity.film_node_sha256,
            changed_identity.film_node_sha256
        );
        assert_ne!(
            thumbnail_key(&first_identity, &first.look_id).unwrap(),
            thumbnail_key(&changed_identity, &changed.look_id).unwrap()
        );
    }

    #[test]
    fn upstream_and_film_mutations_invalidate_the_intended_boundaries() {
        let base = request();
        let identity = build_identity(&base, 99).unwrap();
        let mut upstream = request();
        upstream.adjustments["exposure"] = serde_json::json!(1.0);
        let upstream = build_identity(&upstream, 99).unwrap();
        assert_ne!(
            identity.upstream_graph_sha256,
            upstream.upstream_graph_sha256
        );
        assert_eq!(identity.film_node_sha256, upstream.film_node_sha256);

        let mut film = request();
        film.adjustments["filmLookStrength"] = serde_json::json!(80);
        let film = build_identity(&film, 99).unwrap();
        assert_eq!(identity.upstream_graph_sha256, film.upstream_graph_sha256);
        assert_ne!(identity.film_node_sha256, film.film_node_sha256);
    }

    #[test]
    fn every_renderer_authoritative_thumbnail_boundary_changes_the_full_key() {
        let base = request();
        let base_identity = build_identity(&base, 99).unwrap();
        let base_key = thumbnail_key(&base_identity, &base.look_id).unwrap();

        let mut mutations: Vec<(FilmThumbnailRequestV1, u64)> = Vec::new();
        let mut selected_image = request();
        selected_image.selected_image_id = "editor-image-session:2".into();
        mutations.push((selected_image, 99));
        let mut graph = request();
        graph.graph_revision += 1;
        mutations.push((graph, 99));
        let mut upstream = request();
        upstream.adjustments["exposure"] = serde_json::json!(1.25);
        mutations.push((upstream, 99));
        let mut film = request();
        film.adjustments["filmLookStrength"] = serde_json::json!(25);
        mutations.push((film, 99));
        let mut geometry = request();
        geometry.adjustments["rotation"] = serde_json::json!(1);
        mutations.push((geometry, 99));
        let mut output = request();
        output.view_output_sha256 = format!("sha256:{}", "b".repeat(64));
        mutations.push((output, 99));
        let mut dimensions = request();
        dimensions.width += 1;
        mutations.push((dimensions, 99));
        mutations.push((request(), 100));

        for (mutation, source_fingerprint) in mutations {
            let identity = build_identity(&mutation, source_fingerprint).unwrap();
            assert_ne!(
                thumbnail_key(&identity, &mutation.look_id).unwrap(),
                base_key
            );
        }
    }

    #[test]
    fn rejects_look_identity_mismatch_before_native_rendering() {
        let mut mismatch = request();
        mismatch.look_id = "film_look.generic.cool_contrast.v1".into();
        assert_eq!(
            validate_request(&mismatch),
            Err("film_thumbnail_invalid_request".to_string())
        );
    }

    #[test]
    fn thumbnail_lanes_cancel_revisions_without_cross_cancelling_distinct_sizes() {
        let card = request();
        let mut next_card_revision = request();
        next_card_revision.graph_revision += 1;
        let mut compare = request();
        compare.width = 320;
        compare.height = 180;

        assert_eq!(thumbnail_lane(&card), thumbnail_lane(&next_card_revision));
        assert_ne!(thumbnail_lane(&card), thumbnail_lane(&compare));
    }
}
