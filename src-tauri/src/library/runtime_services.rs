use std::sync::Arc;

#[derive(Clone)]
pub(crate) struct LibraryRuntimeServices {
    import_jobs: Arc<super::import_job_service::ImportJobService>,
    catalog_indexing: Arc<super::catalog_indexing_service::CatalogIndexingService>,
    thumbnails: Arc<super::thumbnail_generation_service::ThumbnailGenerationService>,
    smart_previews: Arc<super::smart_preview_scheduler::SmartPreviewScheduler>,
    tether: Arc<super::tethering::TetherSessionService>,
}

impl Default for LibraryRuntimeServices {
    fn default() -> Self {
        Self {
            import_jobs: Arc::default(),
            catalog_indexing: Arc::default(),
            thumbnails: Arc::default(),
            smart_previews: super::smart_preview_scheduler::SmartPreviewScheduler::new(64),
            tether: Arc::default(),
        }
    }
}

impl LibraryRuntimeServices {
    pub(crate) fn import_jobs(&self) -> &Arc<super::import_job_service::ImportJobService> {
        &self.import_jobs
    }

    pub(crate) fn catalog_indexing(
        &self,
    ) -> &Arc<super::catalog_indexing_service::CatalogIndexingService> {
        &self.catalog_indexing
    }

    pub(crate) fn thumbnails(
        &self,
    ) -> &Arc<super::thumbnail_generation_service::ThumbnailGenerationService> {
        &self.thumbnails
    }

    pub(crate) fn smart_previews(
        &self,
    ) -> &Arc<super::smart_preview_scheduler::SmartPreviewScheduler> {
        &self.smart_previews
    }

    pub(crate) fn tether(&self) -> &Arc<super::tethering::TetherSessionService> {
        &self.tether
    }
}

#[cfg(all(test, feature = "tauri-test"))]
mod tests {
    use serde_json::{Value, json};
    use tauri::{Manager, ipc::InvokeBody, webview::InvokeRequest};

    fn invoke(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        command: &str,
        body: Value,
        callback: u32,
    ) -> Value {
        tauri::test::get_ipc_response(
            webview,
            InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(callback),
                error: tauri::ipc::CallbackFn(callback + 1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .unwrap_or_else(|error| panic!("{command} IPC failed: {error}"))
        .deserialize()
        .unwrap()
    }

    #[test]
    fn production_library_commands_resolve_through_capability_facade() {
        let app = tauri::test::mock_builder()
            .manage(crate::AppState::new())
            .invoke_handler(tauri::generate_handler![
                crate::file_management::get_active_import_job_status,
                super::super::tethering::open_tether_session,
                super::super::tethering::get_tether_session,
                super::super::tethering::close_tether_session,
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let state = app.state::<crate::AppState>();
        let import = state
            .library()
            .import_jobs()
            .begin_new("facade-runtime-import".into())
            .unwrap();

        let import_status = invoke(&webview, "get_active_import_job_status", json!({}), 0);
        assert_eq!(
            import_status["authority"]["generation"],
            import.authority.generation
        );
        assert_eq!(import_status["authority"]["jobId"], import.authority.job_id);

        let destination = std::env::temp_dir().join(format!(
            "rawengine-library-facade-tether-{}",
            uuid::Uuid::new_v4()
        ));
        let opened = invoke(
            &webview,
            "open_tether_session",
            json!({
                "request": {
                    "cameraId": "fake-sony-ilce-7m4-usb",
                    "destinationRoot": destination.to_string_lossy().to_string(),
                    "providerMode": "fake"
                }
            }),
            2,
        );
        assert_eq!(opened["status"], "open");
        let session_id = opened["session"]["sessionId"].as_str().unwrap().to_string();

        let current = invoke(&webview, "get_tether_session", json!({}), 4);
        assert_eq!(current["session"]["sessionId"], session_id);
        let closed = invoke(&webview, "close_tether_session", json!({}), 6);
        assert_eq!(closed["status"], "closed");
    }
}
