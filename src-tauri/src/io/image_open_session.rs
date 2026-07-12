use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub use rapidraw_types::ImageOpenSessionId;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Notify;

use crate::app_state::AppState;
use crate::image_loader::{
    LoadImageResult, load_image_open_metadata, load_image_prepared, prefetch_image,
};

pub const IMAGE_OPEN_UPDATE_EVENT: &str = "image-open-update";
const MAX_PREFETCH_IN_FLIGHT: usize = 2;
const MAX_PREFETCH_CANDIDATES: usize = 3;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginImageOpenRequest {
    pub session_id: ImageOpenSessionId,
    pub image_id: String,
    pub path: String,
    pub expected_catalog_revision: Option<u64>,
    pub expected_entity_revision: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleImagePrefetchRequest {
    pub collection_generation: u64,
    pub candidates: Vec<String>,
    pub memory_pressure: bool,
    pub workload_busy: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageOpenDiagnostics {
    pub foreground_opens: u64,
    pub metadata_reads: u64,
    pub stale_phase_drops: u64,
    pub prefetch_requested: u64,
    pub prefetch_started: u64,
    pub prefetch_completed: u64,
    pub prefetch_cancelled: u64,
    pub prefetch_promotions: u64,
    pub duplicate_prefetch_drops: u64,
    pub peak_prefetch_in_flight: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginImageOpenResult {
    pub session_id: ImageOpenSessionId,
    pub image_id: String,
    pub metadata_fingerprint: String,
    pub joined_prefetch: bool,
    pub metadata_ready_millis: u64,
    pub decode_ready_millis: u64,
    pub decoded: LoadImageResult,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
enum ImageOpenUpdate {
    MetadataReady {
        session_id: ImageOpenSessionId,
        image_id: String,
        path: String,
        metadata_fingerprint: String,
        metadata: Box<crate::image_processing::ImageMetadata>,
    },
    DecodeReady {
        session_id: ImageOpenSessionId,
        image_id: String,
        path: String,
        width: u32,
        height: u32,
        is_raw: bool,
    },
    Superseded {
        session_id: ImageOpenSessionId,
        image_id: String,
        path: String,
    },
}

#[derive(Default)]
struct CoordinatorInner {
    active_session: Option<(ImageOpenSessionId, String)>,
    collection_generation: u64,
    in_flight: HashMap<String, Arc<Notify>>,
    diagnostics: ImageOpenDiagnostics,
}

#[derive(Clone)]
pub struct ImageOpenCoordinator {
    inner: Arc<Mutex<CoordinatorInner>>,
    prefetch_generation: Arc<AtomicUsize>,
}

impl Default for ImageOpenCoordinator {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(CoordinatorInner::default())),
            prefetch_generation: Arc::new(AtomicUsize::new(0)),
        }
    }
}

impl ImageOpenCoordinator {
    fn begin_foreground(
        &self,
        session: &ImageOpenSessionId,
        path: &str,
    ) -> Result<Option<Arc<Notify>>, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "image open coordinator lock poisoned")?;
        if inner.active_session.as_ref().is_some_and(|(active, _)| {
            active.selection_generation > session.selection_generation
                || (active.selection_generation == session.selection_generation
                    && active.image_session > session.image_session)
        }) {
            inner.diagnostics.stale_phase_drops += 1;
            return Err("image_open_superseded".to_string());
        }
        inner.active_session = Some((session.clone(), path.to_string()));
        inner.diagnostics.foreground_opens += 1;
        inner.diagnostics.metadata_reads += 1;
        let joined = inner.in_flight.get(&prefetch_key(path)).cloned();
        if joined.is_some() {
            inner.diagnostics.prefetch_promotions += 1;
        } else {
            self.prefetch_generation.fetch_add(1, Ordering::SeqCst);
        }
        Ok(joined)
    }

    fn is_current(&self, session: &ImageOpenSessionId, path: &str) -> bool {
        self.inner.lock().is_ok_and(|inner| {
            inner
                .active_session
                .as_ref()
                .is_some_and(|(active, active_path)| active == session && active_path == path)
        })
    }

    fn schedule(
        &self,
        request: &ScheduleImagePrefetchRequest,
    ) -> Vec<(String, Arc<Notify>, usize)> {
        let mut inner = self.inner.lock().unwrap();
        if request.collection_generation != inner.collection_generation {
            inner.collection_generation = request.collection_generation;
            inner.diagnostics.prefetch_cancelled += inner.in_flight.len() as u64;
            self.prefetch_generation.fetch_add(1, Ordering::SeqCst);
        }
        let cancellation_generation = self.prefetch_generation.load(Ordering::SeqCst);
        inner.diagnostics.prefetch_requested += request.candidates.len() as u64;
        let limit = if request.memory_pressure || request.workload_busy {
            1
        } else {
            MAX_PREFETCH_CANDIDATES
        };
        let mut unique = HashSet::new();
        let mut scheduled = Vec::new();
        for path in request.candidates.iter().take(limit) {
            let key = prefetch_key(path);
            if !unique.insert(key.clone()) {
                inner.diagnostics.duplicate_prefetch_drops += 1;
                continue;
            }
            if inner.in_flight.contains_key(&key) {
                inner.diagnostics.duplicate_prefetch_drops += 1;
                continue;
            }
            if inner.in_flight.len() >= MAX_PREFETCH_IN_FLIGHT {
                break;
            }
            let notify = Arc::new(Notify::new());
            inner.in_flight.insert(key, Arc::clone(&notify));
            inner.diagnostics.prefetch_started += 1;
            inner.diagnostics.peak_prefetch_in_flight = inner
                .diagnostics
                .peak_prefetch_in_flight
                .max(inner.in_flight.len());
            scheduled.push((path.clone(), notify, cancellation_generation));
        }
        scheduled
    }

    fn finish_prefetch(&self, path: &str, generation: u64, completed: bool) {
        let mut inner = self.inner.lock().unwrap();
        inner.in_flight.remove(&prefetch_key(path));
        if generation != inner.collection_generation || !completed {
            inner.diagnostics.prefetch_cancelled += 1;
        } else {
            inner.diagnostics.prefetch_completed += 1;
        }
    }

    fn report(&self) -> ImageOpenDiagnostics {
        self.inner.lock().unwrap().diagnostics.clone()
    }
}

fn prefetch_key(path: &str) -> String {
    crate::file_management::parse_virtual_path(path)
        .0
        .to_string_lossy()
        .into_owned()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn promote_editor_initialization(app: &AppHandle) {
    crate::app::startup::request_gpu_initialization(
        app.clone(),
        crate::app::startup::InitializationPriority::EditorDemand,
    );
    crate::app::startup::request_lens_initialization(
        app.clone(),
        crate::app::startup::InitializationPriority::EditorDemand,
    );
}

#[tauri::command]
pub async fn begin_image_open(
    request: BeginImageOpenRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<BeginImageOpenResult, String> {
    let started = Instant::now();
    if !app
        .state::<crate::library::catalog::LibraryCatalog>()
        .validates_open_revision(
            &app,
            &request.image_id,
            request.expected_catalog_revision,
            request.expected_entity_revision,
        )?
    {
        return Err("image_open_revision_mismatch".to_string());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    promote_editor_initialization(&app);
    let joined = state
        .image_open_coordinator
        .begin_foreground(&request.session_id, &request.path)?;
    if let Some(notify) = &joined {
        let _ = tokio::time::timeout(Duration::from_secs(30), notify.notified()).await;
    }
    if !state
        .image_open_coordinator
        .is_current(&request.session_id, &request.path)
    {
        let _ = app.emit(
            IMAGE_OPEN_UPDATE_EVENT,
            ImageOpenUpdate::Superseded {
                session_id: request.session_id,
                image_id: request.image_id,
                path: request.path,
            },
        );
        return Err("image_open_superseded".to_string());
    }
    let metadata = load_image_open_metadata(&request.path)?;
    let metadata_fingerprint =
        blake3::hash(&serde_json::to_vec(&metadata).map_err(|error| error.to_string())?)
            .to_hex()
            .to_string();
    let metadata_ready_millis = started.elapsed().as_millis() as u64;
    let _ = app.emit(
        IMAGE_OPEN_UPDATE_EVENT,
        ImageOpenUpdate::MetadataReady {
            session_id: request.session_id.clone(),
            image_id: request.image_id.clone(),
            path: request.path.clone(),
            metadata_fingerprint: metadata_fingerprint.clone(),
            metadata: Box::new(metadata.clone()),
        },
    );
    if !state
        .image_open_coordinator
        .is_current(&request.session_id, &request.path)
    {
        return Err("image_open_superseded".to_string());
    }
    let decoded = load_image_prepared(
        request.path.clone(),
        state.inner(),
        app.clone(),
        metadata,
        true,
        None,
    )
    .await?;
    if !state
        .image_open_coordinator
        .is_current(&request.session_id, &request.path)
    {
        return Err("image_open_superseded".to_string());
    }
    let decode_ready_millis = started.elapsed().as_millis() as u64;
    let _ = app.emit(
        IMAGE_OPEN_UPDATE_EVENT,
        ImageOpenUpdate::DecodeReady {
            session_id: request.session_id.clone(),
            image_id: request.image_id.clone(),
            path: request.path.clone(),
            width: decoded.width,
            height: decoded.height,
            is_raw: decoded.is_raw,
        },
    );
    Ok(BeginImageOpenResult {
        session_id: request.session_id,
        image_id: request.image_id,
        metadata_fingerprint,
        joined_prefetch: joined.is_some(),
        metadata_ready_millis,
        decode_ready_millis,
        decoded,
    })
}

#[tauri::command]
pub fn schedule_image_prefetch(
    request: ScheduleImagePrefetchRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> ImageOpenDiagnostics {
    let generation = request.collection_generation;
    for (path, notify, cancellation_generation) in state.image_open_coordinator.schedule(&request) {
        let task_app = app.clone();
        let cancellation = Arc::clone(&state.image_open_coordinator.prefetch_generation);
        tauri::async_runtime::spawn(async move {
            let task_state = task_app.state::<AppState>();
            let completed = prefetch_image(
                path.clone(),
                task_state.inner(),
                task_app.clone(),
                Some((cancellation, cancellation_generation)),
            )
            .await
            .is_ok();
            task_state
                .image_open_coordinator
                .finish_prefetch(&path, generation, completed);
            notify.notify_one();
        });
    }
    state.image_open_coordinator.report()
}

#[tauri::command]
pub fn get_image_open_diagnostics(state: State<'_, AppState>) -> ImageOpenDiagnostics {
    state.image_open_coordinator.report()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheduler_bounds_deduplicates_and_shrinks_under_pressure() {
        let coordinator = ImageOpenCoordinator::default();
        let scheduled = coordinator.schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 1,
            candidates: vec!["next.raw".into(), "next.raw".into(), "next-2.raw".into()],
            memory_pressure: false,
            workload_busy: false,
        });
        assert_eq!(scheduled.len(), 2);
        let pressured = ImageOpenCoordinator::default().schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 1,
            candidates: vec!["next.raw".into(), "next-2.raw".into()],
            memory_pressure: true,
            workload_busy: false,
        });
        assert_eq!(pressured.len(), 1);
    }

    #[test]
    fn newest_session_wins_and_matching_prefetch_promotes() {
        let coordinator = ImageOpenCoordinator::default();
        let scheduled = coordinator.schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 1,
            candidates: vec!["b.raw".into()],
            memory_pressure: false,
            workload_busy: false,
        });
        let b = ImageOpenSessionId {
            selection_generation: 2,
            image_session: 2,
        };
        assert!(coordinator.begin_foreground(&b, "b.raw").unwrap().is_some());
        let a = ImageOpenSessionId {
            selection_generation: 1,
            image_session: 1,
        };
        assert_eq!(
            coordinator.begin_foreground(&a, "a.raw").unwrap_err(),
            "image_open_superseded"
        );
        assert_eq!(scheduled.len(), 1);
        assert_eq!(coordinator.report().prefetch_promotions, 1);
    }

    #[test]
    fn collection_change_accounts_old_in_flight_as_cancelled() {
        let coordinator = ImageOpenCoordinator::default();
        coordinator.schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 1,
            candidates: vec!["old.raw".into()],
            memory_pressure: false,
            workload_busy: false,
        });
        coordinator.schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 2,
            candidates: vec!["new.raw".into()],
            memory_pressure: false,
            workload_busy: false,
        });
        assert_eq!(coordinator.report().prefetch_cancelled, 1);
    }

    #[test]
    fn collection_change_and_unmatched_foreground_invalidate_decode_tokens() {
        let coordinator = ImageOpenCoordinator::default();
        let first = coordinator.schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 1,
            candidates: vec!["old.raw".into()],
            memory_pressure: false,
            workload_busy: false,
        });
        let first_token = first[0].2;
        let second = coordinator.schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 2,
            candidates: vec!["new.raw".into()],
            memory_pressure: false,
            workload_busy: false,
        });
        assert_ne!(first_token, second[0].2);

        let session = ImageOpenSessionId {
            selection_generation: 1,
            image_session: 1,
        };
        coordinator
            .begin_foreground(&session, "foreground.raw")
            .unwrap();
        assert_ne!(
            second[0].2,
            coordinator.prefetch_generation.load(Ordering::SeqCst)
        );
    }

    #[test]
    fn virtual_copies_share_one_physical_prefetch_and_promote() {
        let coordinator = ImageOpenCoordinator::default();
        let source = "/library/source.raw";
        let first = format!("{source}?vc=copy-a");
        let second = format!("{source}?vc=copy-b");
        let scheduled = coordinator.schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 1,
            candidates: vec![first, second.clone()],
            memory_pressure: false,
            workload_busy: false,
        });
        assert_eq!(scheduled.len(), 1);
        let session = ImageOpenSessionId {
            selection_generation: 1,
            image_session: 1,
        };
        assert!(
            coordinator
                .begin_foreground(&session, &second)
                .unwrap()
                .is_some()
        );
    }
}
