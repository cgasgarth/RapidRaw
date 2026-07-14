#[cfg(feature = "ai")]
use std::collections::HashSet;
#[cfg(feature = "ai")]
use std::fs;
#[cfg(feature = "ai")]
use std::sync::Arc;
#[cfg(feature = "ai")]
use std::sync::atomic::Ordering;

#[cfg(feature = "ai")]
use futures::stream::{self, StreamExt};
#[cfg(feature = "ai")]
use tauri::Manager;
use tauri::{AppHandle, Emitter, State};

use crate::AppState;
#[cfg(feature = "ai")]
use crate::library::catalog_indexing_service::CatalogIndexingService;
use crate::library::catalog_indexing_service::{CatalogIndexingAuthority, CatalogIndexingSnapshot};

fn emit_snapshot(app: &AppHandle, event: &str, snapshot: &CatalogIndexingSnapshot) {
    let _ = app.emit(event, snapshot);
}

#[cfg(feature = "ai")]
fn persist_tags_if_current(
    service: &CatalogIndexingService,
    authority: CatalogIndexingAuthority,
    sidecar_path: &std::path::Path,
    metadata: crate::image_processing::ImageMetadata,
    tags: Vec<String>,
) -> Result<bool, String> {
    persist_tags_if_current_with_hook(service, authority, sidecar_path, metadata, tags, || {})
}

#[cfg(feature = "ai")]
fn persist_tags_if_current_with_hook(
    service: &CatalogIndexingService,
    authority: CatalogIndexingAuthority,
    sidecar_path: &std::path::Path,
    mut metadata: crate::image_processing::ImageMetadata,
    tags: Vec<String>,
    before_publish: impl FnOnce(),
) -> Result<bool, String> {
    if !service.is_current(authority) {
        return Ok(false);
    }
    let mut merged: HashSet<String> = metadata.tags.unwrap_or_default().into_iter().collect();
    merged.extend(tags);
    let mut merged = merged.into_iter().collect::<Vec<_>>();
    merged.sort_unstable();
    metadata.tags = Some(merged);
    before_publish();
    if !service.is_current(authority) {
        return Ok(false);
    }
    crate::exif_processing::save_sidecar_metadata_atomic(sidecar_path, &metadata)?;
    Ok(true)
}

#[tauri::command]
pub(crate) async fn start_background_indexing(
    folder_path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<CatalogIndexingAuthority, String> {
    #[cfg(not(feature = "ai"))]
    {
        let _ = (folder_path, app_handle, state);
        Err("ai_tagging_unavailable:build_without_ai_feature".to_string())
    }

    #[cfg(feature = "ai")]
    {
        let service = Arc::clone(&state.services.catalog_indexing);
        let start = service.begin(folder_path.clone()).map_err(str::to_string)?;
        if let Some(cancelled) = start.cancelled_predecessor.as_ref() {
            emit_snapshot(&app_handle, crate::events::INDEXING_FINISHED, cancelled);
        }
        let admitted = service
            .set_total(start.authority, 0)
            .ok_or_else(|| "catalog_indexing_superseded_before_admission".to_string())?;
        emit_snapshot(&app_handle, crate::events::INDEXING_STARTED, &admitted);

        let settings = match crate::load_settings(app_handle.clone()) {
            Ok(settings) => settings,
            Err(error) => {
                if let Some(terminal) = service.fail(start.authority) {
                    let _ = app_handle.emit(
                        crate::events::INDEXING_ERROR,
                        serde_json::json!({
                            "authority": terminal.authority,
                            "error": error,
                        }),
                    );
                    emit_snapshot(&app_handle, crate::events::INDEXING_FINISHED, &terminal);
                }
                return Err(error);
            }
        };
        if !settings.enable_ai_tagging.unwrap_or(false) {
            if let Some(terminal) = service.complete(start.authority) {
                emit_snapshot(&app_handle, crate::events::INDEXING_FINISHED, &terminal);
            }
            return Ok(start.authority);
        }

        let max_concurrent_tasks = settings.tagging_thread_count.unwrap_or(3).max(1) as usize;
        let custom_ai_tags = settings.custom_ai_tags.clone();
        let ai_tag_count = settings.ai_tag_count.unwrap_or(10) as usize;
        let clip_lease = match crate::ai::ai_processing::acquire_clip_model(
            &app_handle,
            &state.ai_model_registry,
        )
        .await
        {
            Ok(lease) => lease,
            Err(error) => {
                if let Some(terminal) = service.fail(start.authority) {
                    let _ = app_handle.emit(
                        crate::events::INDEXING_ERROR,
                        serde_json::json!({
                            "authority": terminal.authority,
                            "error": error.to_string(),
                        }),
                    );
                    emit_snapshot(&app_handle, crate::events::INDEXING_FINISHED, &terminal);
                }
                return Err(error.to_string());
            }
        };
        let clip_models = match clip_lease.clip() {
            Ok(models) => models,
            Err(error) => {
                if let Some(terminal) = service.fail(start.authority) {
                    let _ = app_handle.emit(
                        crate::events::INDEXING_ERROR,
                        serde_json::json!({
                            "authority": terminal.authority,
                            "error": error,
                        }),
                    );
                    emit_snapshot(&app_handle, crate::events::INDEXING_FINISHED, &terminal);
                }
                return Err(error);
            }
        };
        if !service.is_current(start.authority) {
            return Ok(start.authority);
        }
        let authority = start.authority;
        let cancellation = Arc::clone(&start.cancellation);
        let task_service = Arc::clone(&service);
        let task_app = app_handle.clone();
        let task = tokio::spawn(async move {
            let _clip_lease = clip_lease;
            if !task_service.is_current(authority) {
                return;
            }
            let state = task_app.state::<AppState>();
            let gpu_context =
                crate::gpu_processing::get_or_init_gpu_context(&state, &task_app).ok();
            let image_paths = match fs::read_dir(&folder_path) {
                Ok(entries) => entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .filter(|path| {
                        path.is_file()
                            && crate::formats::is_supported_image_file(
                                path.to_string_lossy().as_ref(),
                            )
                    })
                    .collect::<Vec<_>>(),
                Err(error) => {
                    if let Some(terminal) = task_service.fail(authority) {
                        let _ = task_app.emit(
                            crate::events::INDEXING_ERROR,
                            serde_json::json!({
                                "authority": terminal.authority,
                                "error": format!("Failed to read directory: {error}"),
                            }),
                        );
                        emit_snapshot(&task_app, crate::events::INDEXING_FINISHED, &terminal);
                    }
                    return;
                }
            };
            let total = image_paths.len();
            let Some(progress) = task_service.set_total(authority, total) else {
                return;
            };
            emit_snapshot(&task_app, crate::events::INDEXING_PROGRESS, &progress);
            let custom_ai_tags = Arc::new(custom_ai_tags);

            stream::iter(image_paths)
                .for_each_concurrent(max_concurrent_tasks, |path| {
                    let app = task_app.clone();
                    let clip_models = clip_models.clone();
                    let gpu_context = gpu_context.clone();
                    let service = Arc::clone(&task_service);
                    let cancellation = Arc::clone(&cancellation);
                    let custom_ai_tags = Arc::clone(&custom_ai_tags);
                    async move {
                        if cancellation.load(Ordering::Acquire) || !service.is_current(authority) {
                            return;
                        }
                        let path_str = path.to_string_lossy().to_string();
                        let (_, sidecar_path) =
                            crate::file_management::parse_virtual_path(&path_str);
                        let metadata = crate::exif_processing::load_sidecar(&sidecar_path);
                        let should_generate_tags = metadata.tags.as_ref().is_none_or(|tags| {
                            !tags.iter().any(|tag| {
                                !tag.starts_with(super::COLOR_TAG_PREFIX)
                                    && !tag.starts_with(super::USER_TAG_PREFIX)
                            })
                        });

                        if should_generate_tags
                            && let Ok(image) =
                                crate::file_management::get_cached_or_generate_thumbnail_image(
                                    &path_str,
                                    &app,
                                    gpu_context.as_ref(),
                                )
                            && let Ok(ai_tags) = super::generate_tags_with_clip(
                                &image,
                                &clip_models.model,
                                &clip_models.tokenizer,
                                (*custom_ai_tags).clone(),
                                ai_tag_count,
                            )
                            && service.is_current(authority)
                            && !cancellation.load(Ordering::Acquire)
                        {
                            let _ = persist_tags_if_current(
                                &service,
                                authority,
                                &sidecar_path,
                                metadata,
                                ai_tags,
                            );
                        }

                        if let Some(progress) = service.record_completed(authority) {
                            emit_snapshot(&app, crate::events::INDEXING_PROGRESS, &progress);
                        }
                    }
                })
                .await;

            if let Some(terminal) = task_service.complete(authority) {
                emit_snapshot(&task_app, crate::events::INDEXING_FINISHED, &terminal);
            }
        });
        if !service.attach_task(authority, task.abort_handle()) {
            task.abort();
            return Ok(authority);
        }
        Ok(authority)
    }
}

#[tauri::command]
pub(crate) fn cancel_background_indexing(
    authority: CatalogIndexingAuthority,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> bool {
    let Some(terminal) = state.services.catalog_indexing.cancel(authority) else {
        return false;
    };
    emit_snapshot(&app_handle, crate::events::INDEXING_FINISHED, &terminal);
    true
}

#[cfg(all(test, feature = "ai"))]
mod tests {
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Barrier};

    use super::*;

    fn proof_metadata() -> crate::image_processing::ImageMetadata {
        crate::image_processing::ImageMetadata::default()
    }

    #[test]
    fn stale_operation_cannot_publish_sidecar_tags_after_successor_begins() {
        let temp = tempfile::tempdir().unwrap();
        let sidecar = temp.path().join("image.raw.rrdata");
        let service = CatalogIndexingService::default();
        let stale = service.begin("first".into()).unwrap();
        let successor = service.begin("second".into()).unwrap();

        assert!(
            !persist_tags_if_current(
                &service,
                stale.authority,
                &sidecar,
                proof_metadata(),
                vec!["stale".into()],
            )
            .unwrap()
        );
        assert!(!sidecar.exists());
        assert!(
            persist_tags_if_current(
                &service,
                successor.authority,
                &sidecar,
                proof_metadata(),
                vec!["current".into()],
            )
            .unwrap()
        );
        let reopened = crate::exif_processing::load_sidecar(&sidecar);
        assert_eq!(reopened.tags, Some(vec!["current".into()]));
    }

    #[test]
    fn forced_cancellation_during_publication_preparation_rejects_stale_output() {
        let temp = tempfile::tempdir().unwrap();
        let sidecar = temp.path().join("image.raw.rrdata");
        let service = Arc::new(CatalogIndexingService::default());
        let operation = service.begin("first".into()).unwrap();
        let prepared = Arc::new(Barrier::new(2));
        let resume = Arc::new(Barrier::new(2));
        let worker = {
            let service = Arc::clone(&service);
            let sidecar = sidecar.clone();
            let prepared = Arc::clone(&prepared);
            let resume = Arc::clone(&resume);
            std::thread::spawn(move || {
                persist_tags_if_current_with_hook(
                    &service,
                    operation.authority,
                    &sidecar,
                    proof_metadata(),
                    vec!["stale".into()],
                    || {
                        prepared.wait();
                        resume.wait();
                    },
                )
            })
        };

        prepared.wait();
        let successor = service.begin("second".into()).unwrap();
        resume.wait();

        assert!(!worker.join().unwrap().unwrap());
        assert!(!sidecar.exists());
        assert!(service.is_current(successor.authority));
    }

    #[test]
    fn private_raw_catalog_sidecar_publication_proof_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_CATALOG_INDEXING_PROOF").as_deref() != Ok("1") {
            return;
        }
        let root = PathBuf::from(
            std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
                .expect("RAWENGINE_PRIVATE_RAW_ROOT must identify the private RAW root"),
        );
        let source = first_raw(&root).expect("private RAW root must contain a supported RAW");
        let source_bytes = std::fs::read(&source).expect("read private RAW");
        let temp = tempfile::tempdir().unwrap();
        let copied_raw = temp.path().join(source.file_name().unwrap());
        std::fs::copy(&source, &copied_raw).expect("copy private RAW into isolated proof root");
        let sidecar = crate::exif_processing::get_primary_sidecar_path(&copied_raw);
        let service = CatalogIndexingService::default();
        let operation = service.begin(temp.path().display().to_string()).unwrap();

        assert!(
            persist_tags_if_current(
                &service,
                operation.authority,
                &sidecar,
                proof_metadata(),
                vec!["rawengine-private-catalog-proof".into()],
            )
            .expect("publish catalog tags beside copied private RAW")
        );
        let reopened = crate::exif_processing::load_sidecar(&sidecar);
        assert_eq!(
            reopened.tags,
            Some(vec!["rawengine-private-catalog-proof".into()])
        );
        assert_eq!(
            std::fs::read(&copied_raw).expect("reopen copied private RAW"),
            source_bytes,
            "catalog publication must not mutate source RAW bytes"
        );
        eprintln!(
            "private_raw_catalog_indexing_proof source={} sidecar={} bytes={}",
            source.display(),
            sidecar.display(),
            source_bytes.len()
        );
    }

    fn first_raw(root: &Path) -> Option<PathBuf> {
        walkdir::WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .map(|entry| entry.into_path())
            .find(|path| {
                path.is_file() && crate::formats::is_raw_file(path.to_string_lossy().as_ref())
            })
    }
}
