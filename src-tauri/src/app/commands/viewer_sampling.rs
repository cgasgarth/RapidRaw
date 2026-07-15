use crate::app_state::AppState;
use crate::editor::viewer_sampling_service::{ViewerSampleRequest, ViewerSampleResponse};

#[tauri::command]
pub(crate) fn sample_viewer_pixel(
    request: ViewerSampleRequest,
    state: tauri::State<'_, AppState>,
) -> ViewerSampleResponse {
    state.editor().sample_viewer_pixel(request)
}

#[cfg(all(test, feature = "tauri-test"))]
mod ipc_tests {
    use std::sync::Arc;

    use image::{DynamicImage, ImageBuffer};
    use serde_json::{Value, json};
    use tauri::{ipc::InvokeBody, webview::InvokeRequest};

    use super::*;
    use crate::editor::image_service::LoadedImage;
    use crate::editor::viewer_sampling_service::{
        CachedViewerSampleFrame, SampleablePixels, ViewerSampleCacheSlot,
        ViewerSamplePublishDisposition,
    };
    use crate::render::artifact_identity::{RenderArtifactIdentity, tests_support::source};

    fn invoke(webview: &tauri::WebviewWindow<tauri::test::MockRuntime>, body: Value) -> Value {
        tauri::test::get_ipc_response(
            webview,
            InvokeRequest {
                cmd: "sample_viewer_pixel".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .unwrap_or_else(|error| panic!("sample_viewer_pixel IPC failed: {error}"))
        .deserialize()
        .unwrap()
    }

    #[test]
    fn production_command_samples_current_synthetic_frame_through_exact_ipc_contract() {
        let state = AppState::new();
        let path = "/fixtures/ipc-viewer-sample.raw";
        let source = source(path);
        let image = Arc::new(DynamicImage::ImageRgb8(ImageBuffer::from_pixel(
            1,
            1,
            image::Rgb([64, 128, 255]),
        )));
        state.editor().install_active_image(
            17,
            path,
            LoadedImage {
                path: path.to_string(),
                image: Arc::clone(&image),
                is_raw: true,
                artifact_source: source.clone(),
            },
        );
        assert_eq!(
            state.editor().publish_viewer_sample(
                ViewerSampleCacheSlot::Edited,
                CachedViewerSampleFrame {
                    artifact_identity: RenderArtifactIdentity::source_geometry(
                        &source, 17, 1, 1, 1, 1, 1,
                    ),
                    graph_revision: "graph-ipc".to_string(),
                    pixels: SampleablePixels::native(image),
                    image_identity: path.to_string(),
                    space_label: "Display encoded sRGB".to_string(),
                },
            ),
            ViewerSamplePublishDisposition::Published
        );

        let app = tauri::test::mock_builder()
            .manage(state)
            .invoke_handler(tauri::generate_handler![sample_viewer_pixel])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let response = invoke(
            &webview,
            json!({
                "request": {
                    "requestIdentity": "ipc-request",
                    "imageIdentity": path,
                    "graphRevision": "graph-ipc",
                    "geometryEpoch": 3,
                    "normalizedImagePoint": { "x": 0.0, "y": 0.0 },
                    "sourceImageSize": { "width": 1, "height": 1 },
                    "target": "edited",
                    "sampleRadiusImagePx": 0,
                    "requestedSpace": "displayEncoded"
                }
            }),
        );

        assert_eq!(response["status"], "available");
        assert_eq!(response["requestIdentity"], "ipc-request");
        assert_eq!(response["imagePointPx"], json!({ "x": 0, "y": 0 }));
        assert_eq!(response["spaceLabel"], "Display encoded sRGB");
        assert_eq!(response["rgb"], json!([64.0 / 255.0, 128.0 / 255.0, 1.0]));
        assert_eq!(response["clippedChannels"], json!(["b"]));
    }
}
