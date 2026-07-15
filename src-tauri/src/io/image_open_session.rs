use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub use rapidraw_types::ImageOpenSessionId;
use rawler::rawsource::RawSource;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Notify;

use crate::app_state::AppState;
use crate::image_loader::{
    LoadImageResult, load_image_open_metadata, load_image_prepared, prefetch_image,
};
use crate::raw::embedded_preview::{
    ExtractedEmbeddedPreview, ImageFrameQuality, ProgressiveImageFrameReceipt,
    extract_embedded_preview_from_source, with_provisional_thread_priority,
};

pub const IMAGE_OPEN_UPDATE_EVENT: &str = "image-open-update";
const MAX_PREFETCH_IN_FLIGHT: usize = 2;
const MAX_PREFETCH_CANDIDATES: usize = 3;
const EMBEDDED_PREVIEW_CACHE_BUDGET_BYTES: usize = 64 * 1024 * 1024;
const EMBEDDED_PREVIEW_POLICY_VERSION: &str = "embedded-preview-v1";
const EMBEDDED_PREVIEW_LATENCY_BUDGET: Duration = Duration::from_millis(250);

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
    pub embedded_preview_attempted: u64,
    pub embedded_preview_published: u64,
    pub embedded_preview_rejected: u64,
    pub embedded_preview_stale_suppressed: u64,
    pub embedded_preview_encoded_bytes: u64,
    pub embedded_preview_elapsed_millis: u64,
    pub embedded_preview_cache_hits: u64,
    pub last_embedded_candidate_width: u32,
    pub last_embedded_candidate_height: u32,
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
        receipt: ProgressiveImageFrameReceipt,
    },
    FrameReady {
        session_id: ImageOpenSessionId,
        image_id: String,
        path: String,
        data_url: String,
        receipt: ProgressiveImageFrameReceipt,
    },
    FallbackFrameReady {
        session_id: ImageOpenSessionId,
        image_id: String,
        path: String,
        receipt: ProgressiveImageFrameReceipt,
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
    frame_generation: u64,
    settled_frame_published: bool,
    collection_generation: u64,
    in_flight: HashMap<String, InFlightPrefetch>,
    diagnostics: ImageOpenDiagnostics,
    embedded_preview_cache: HashMap<String, Arc<ExtractedEmbeddedPreview>>,
    embedded_preview_cache_order: VecDeque<String>,
    embedded_preview_cache_bytes: usize,
}

struct InFlightPrefetch {
    identity: PrefetchOperationIdentity,
    notify: Arc<Notify>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PrefetchOperationIdentity {
    collection_generation: u64,
    cancellation_generation: usize,
}

struct ScheduledPrefetch {
    path: String,
    notify: Arc<Notify>,
    identity: PrefetchOperationIdentity,
}

#[derive(Clone)]
pub(crate) struct ImageOpenCoordinator {
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
        inner.frame_generation = 0;
        inner.settled_frame_published = false;
        inner.diagnostics.foreground_opens += 1;
        inner.diagnostics.metadata_reads += 1;
        let joined = inner
            .in_flight
            .get(&prefetch_key(path))
            .map(|prefetch| Arc::clone(&prefetch.notify));
        if joined.is_some() {
            inner.diagnostics.prefetch_promotions += 1;
        } else {
            Self::cancel_in_flight(&mut inner);
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

    fn claim_frame(
        &self,
        session: &ImageOpenSessionId,
        path: &str,
        quality: ImageFrameQuality,
    ) -> Option<u64> {
        let mut inner = self.inner.lock().ok()?;
        let current = inner
            .active_session
            .as_ref()
            .is_some_and(|(active, active_path)| active == session && active_path == path);
        if !current
            || (inner.settled_frame_published && quality != ImageFrameQuality::SettledDeveloped)
        {
            if quality != ImageFrameQuality::SettledDeveloped {
                inner.diagnostics.embedded_preview_stale_suppressed += 1;
            } else {
                inner.diagnostics.stale_phase_drops += 1;
            }
            return None;
        }
        inner.frame_generation += 1;
        if quality == ImageFrameQuality::SettledDeveloped {
            inner.settled_frame_published = true;
        }
        Some(inner.frame_generation)
    }

    fn record_embedded_attempt(&self) {
        self.inner
            .lock()
            .unwrap()
            .diagnostics
            .embedded_preview_attempted += 1;
    }

    fn record_embedded_rejection(&self) {
        self.inner
            .lock()
            .unwrap()
            .diagnostics
            .embedded_preview_rejected += 1;
    }

    fn record_embedded_publish(
        &self,
        elapsed_millis: u64,
        encoded_bytes: usize,
        candidate_width: u32,
        candidate_height: u32,
    ) {
        let mut inner = self.inner.lock().unwrap();
        inner.diagnostics.embedded_preview_published += 1;
        inner.diagnostics.embedded_preview_elapsed_millis += elapsed_millis;
        inner.diagnostics.embedded_preview_encoded_bytes += encoded_bytes as u64;
        inner.diagnostics.last_embedded_candidate_width = candidate_width;
        inner.diagnostics.last_embedded_candidate_height = candidate_height;
    }

    fn embedded_cache_key(path: &std::path::Path) -> Option<String> {
        crate::source_revision::SourceRevision::from_path(path)
            .ok()
            .map(|revision| format!("{EMBEDDED_PREVIEW_POLICY_VERSION}:{}", revision.identity()))
    }

    fn cached_embedded_preview(
        &self,
        path: &std::path::Path,
    ) -> Option<Arc<ExtractedEmbeddedPreview>> {
        let key = Self::embedded_cache_key(path)?;
        let mut inner = self.inner.lock().ok()?;
        let preview = Arc::clone(inner.embedded_preview_cache.get(&key)?);
        inner.diagnostics.embedded_preview_cache_hits += 1;
        Some(preview)
    }

    fn cache_embedded_preview(
        &self,
        path: &std::path::Path,
        preview: ExtractedEmbeddedPreview,
    ) -> Arc<ExtractedEmbeddedPreview> {
        let Some(key) = Self::embedded_cache_key(path) else {
            return Arc::new(preview);
        };
        let preview = Arc::new(preview);
        let mut inner = self.inner.lock().unwrap();
        let retained_bytes = preview.data_url.len();
        if let Some(replaced) = inner.embedded_preview_cache.remove(&key) {
            inner.embedded_preview_cache_bytes = inner
                .embedded_preview_cache_bytes
                .saturating_sub(replaced.data_url.len());
            inner
                .embedded_preview_cache_order
                .retain(|entry| entry != &key);
        }
        while inner.embedded_preview_cache_bytes + retained_bytes
            > EMBEDDED_PREVIEW_CACHE_BUDGET_BYTES
        {
            let Some(oldest) = inner.embedded_preview_cache_order.pop_front() else {
                break;
            };
            if let Some(removed) = inner.embedded_preview_cache.remove(&oldest) {
                inner.embedded_preview_cache_bytes = inner
                    .embedded_preview_cache_bytes
                    .saturating_sub(removed.data_url.len());
            }
        }
        inner.embedded_preview_cache_bytes += retained_bytes;
        inner.embedded_preview_cache_order.push_back(key.clone());
        inner
            .embedded_preview_cache
            .insert(key, Arc::clone(&preview));
        preview
    }

    fn schedule(&self, request: &ScheduleImagePrefetchRequest) -> Vec<ScheduledPrefetch> {
        let mut inner = self.inner.lock().unwrap();
        if request.collection_generation != inner.collection_generation {
            inner.collection_generation = request.collection_generation;
            Self::cancel_in_flight(&mut inner);
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
            let identity = PrefetchOperationIdentity {
                collection_generation: request.collection_generation,
                cancellation_generation,
            };
            inner.in_flight.insert(
                key,
                InFlightPrefetch {
                    identity,
                    notify: Arc::clone(&notify),
                },
            );
            inner.diagnostics.prefetch_started += 1;
            inner.diagnostics.peak_prefetch_in_flight = inner
                .diagnostics
                .peak_prefetch_in_flight
                .max(inner.in_flight.len());
            scheduled.push(ScheduledPrefetch {
                path: path.clone(),
                notify,
                identity,
            });
        }
        scheduled
    }

    fn finish_prefetch(&self, path: &str, identity: PrefetchOperationIdentity, completed: bool) {
        let mut inner = self.inner.lock().unwrap();
        let key = prefetch_key(path);
        let owns_entry = inner
            .in_flight
            .get(&key)
            .is_some_and(|prefetch| prefetch.identity == identity);
        if !owns_entry {
            return;
        }
        inner.in_flight.remove(&key);
        if identity.collection_generation != inner.collection_generation || !completed {
            inner.diagnostics.prefetch_cancelled += 1;
        } else {
            inner.diagnostics.prefetch_completed += 1;
        }
    }

    fn cancel_in_flight(inner: &mut CoordinatorInner) {
        inner.diagnostics.prefetch_cancelled += inner.in_flight.len() as u64;
        for (_, prefetch) in inner.in_flight.drain() {
            prefetch.notify.notify_one();
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
        .image_open()
        .begin_foreground(&request.session_id, &request.path)?;
    if let Some(notify) = &joined {
        let _ = tokio::time::timeout(Duration::from_secs(30), notify.notified()).await;
    }
    if !state
        .image_open()
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
    let (source_path, _) = crate::file_management::parse_virtual_path(&request.path);
    let prepared_raw_source = if crate::formats::is_raw_file(&request.path) {
        Some(Arc::new(
            RawSource::new(&source_path).map_err(|error| error.to_string())?,
        ))
    } else {
        None
    };
    if crate::formats::is_raw_file(&request.path) {
        let preview_coordinator = state.image_open().clone();
        preview_coordinator.record_embedded_attempt();
        let preview_source_path = source_path.clone();
        let preview_session = request.session_id.clone();
        let preview_request_path = request.path.clone();
        let preview_image_id = request.image_id.clone();
        let preview_source = Arc::clone(
            prepared_raw_source
                .as_ref()
                .expect("RAW source prepared for embedded extraction"),
        );
        let preview_app = app.clone();
        let preview_budget = EMBEDDED_PREVIEW_LATENCY_BUDGET.saturating_sub(started.elapsed());
        tauri::async_runtime::spawn(async move {
            let cached = preview_coordinator.cached_embedded_preview(&preview_source_path);
            let extraction = if let Some(preview) = cached {
                Ok(preview)
            } else {
                let extraction_coordinator = preview_coordinator.clone();
                let extraction_session = preview_session.clone();
                let extraction_request_path = preview_request_path.clone();
                let extraction_source_path = preview_source_path.clone();
                match tokio::time::timeout(
                    preview_budget,
                    tokio::task::spawn_blocking(move || {
                        with_provisional_thread_priority(|| {
                            extract_embedded_preview_from_source(
                                &preview_source,
                                &extraction_source_path,
                                extraction_session.image_session,
                                extraction_session.selection_generation,
                                0,
                                || {
                                    !extraction_coordinator
                                        .is_current(&extraction_session, &extraction_request_path)
                                },
                            )
                        })
                    }),
                )
                .await
                {
                    Ok(Ok(Ok(preview))) => {
                        Ok(preview_coordinator
                            .cache_embedded_preview(&preview_source_path, preview))
                    }
                    _ => Err(()),
                }
            };
            let Ok(preview) = extraction else {
                preview_coordinator.record_embedded_rejection();
                if let Some(frame_generation) = preview_coordinator.claim_frame(
                    &preview_session,
                    &preview_request_path,
                    ImageFrameQuality::FastDeveloped,
                ) {
                    let source_revision =
                        crate::source_revision::SourceRevision::from_path(&preview_source_path)
                            .map(|revision| revision.identity())
                            .unwrap_or_else(|_| "source-revision-v1:unavailable".to_string());
                    let _ = preview_app.emit(
                        IMAGE_OPEN_UPDATE_EVENT,
                        ImageOpenUpdate::FallbackFrameReady {
                            session_id: preview_session.clone(),
                            image_id: preview_image_id.clone(),
                            path: preview_request_path.clone(),
                            receipt: ProgressiveImageFrameReceipt {
                                image_session: preview_session.image_session,
                                selection_generation: preview_session.selection_generation,
                                source_revision,
                                frame_generation,
                                quality: ImageFrameQuality::FastDeveloped,
                                width: 0,
                                height: 0,
                                orientation_applied: false,
                                source_kind: "current_thumbnail_or_smart_preview".to_string(),
                                color_assumption: "artifact_declared_or_srgb_fallback".to_string(),
                                provisional_reason: Some(
                                    "embedded preview unavailable; non-authoritative library artifact"
                                        .to_string(),
                                ),
                            },
                        },
                    );
                }
                return;
            };
            let Some(frame_generation) = preview_coordinator.claim_frame(
                &preview_session,
                &preview_request_path,
                ImageFrameQuality::EmbeddedProvisional,
            ) else {
                return;
            };
            let mut receipt = preview.receipt.clone();
            receipt.image_session = preview_session.image_session;
            receipt.selection_generation = preview_session.selection_generation;
            receipt.frame_generation = frame_generation;
            preview_coordinator.record_embedded_publish(
                preview.elapsed_millis,
                preview.encoded_bytes,
                preview.candidate_width,
                preview.candidate_height,
            );
            let _ = preview_app.emit(
                IMAGE_OPEN_UPDATE_EVENT,
                ImageOpenUpdate::FrameReady {
                    session_id: preview_session,
                    image_id: preview_image_id,
                    path: preview_request_path,
                    data_url: preview.data_url.clone(),
                    receipt,
                },
            );
        });
    }
    if !state
        .image_open()
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
        prepared_raw_source,
    )
    .await?;
    if !state
        .image_open()
        .is_current(&request.session_id, &request.path)
    {
        return Err("image_open_superseded".to_string());
    }
    let decode_ready_millis = started.elapsed().as_millis() as u64;
    let frame_generation = state
        .image_open()
        .claim_frame(
            &request.session_id,
            &request.path,
            ImageFrameQuality::SettledDeveloped,
        )
        .ok_or_else(|| "image_open_superseded".to_string())?;
    let source_revision = crate::source_revision::SourceRevision::from_path(&source_path)
        .map_err(|error| error.to_string())?
        .identity();
    let _ = app.emit(
        IMAGE_OPEN_UPDATE_EVENT,
        ImageOpenUpdate::DecodeReady {
            session_id: request.session_id.clone(),
            image_id: request.image_id.clone(),
            path: request.path.clone(),
            width: decoded.width,
            height: decoded.height,
            is_raw: decoded.is_raw,
            receipt: ProgressiveImageFrameReceipt {
                image_session: request.session_id.image_session,
                selection_generation: request.session_id.selection_generation,
                source_revision,
                frame_generation,
                quality: ImageFrameQuality::SettledDeveloped,
                width: decoded.width,
                height: decoded.height,
                orientation_applied: true,
                source_kind: if decoded.is_raw {
                    "raw_developed"
                } else {
                    "non_raw"
                }
                .to_string(),
                color_assumption: "rapidraw_working_color_pipeline".to_string(),
                provisional_reason: None,
            },
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
    for scheduled in state.image_open().schedule(&request) {
        let ScheduledPrefetch {
            path,
            notify,
            identity,
        } = scheduled;
        let task_app = app.clone();
        let cancellation = Arc::clone(&state.image_open().prefetch_generation);
        let cancellation_generation = identity.cancellation_generation;
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
                .image_open()
                .finish_prefetch(&path, identity, completed);
            notify.notify_one();
        });
    }
    state.image_open().report()
}

#[tauri::command]
pub fn get_image_open_diagnostics(state: State<'_, AppState>) -> ImageOpenDiagnostics {
    state.image_open().report()
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
    fn stale_completion_cannot_evict_same_path_from_new_collection() {
        let coordinator = ImageOpenCoordinator::default();
        let first = coordinator.schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 1,
            candidates: vec!["same.raw".into()],
            memory_pressure: false,
            workload_busy: false,
        });
        let first_identity = first[0].identity;
        let second = coordinator.schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 2,
            candidates: vec!["same.raw".into()],
            memory_pressure: false,
            workload_busy: false,
        });
        let second_identity = second[0].identity;
        assert_ne!(first_identity, second_identity);

        coordinator.finish_prefetch("same.raw", first_identity, false);
        assert!(
            coordinator
                .schedule(&ScheduleImagePrefetchRequest {
                    collection_generation: 2,
                    candidates: vec!["same.raw".into()],
                    memory_pressure: false,
                    workload_busy: false,
                })
                .is_empty()
        );

        coordinator.finish_prefetch("same.raw", second_identity, true);
        assert_eq!(
            coordinator
                .schedule(&ScheduleImagePrefetchRequest {
                    collection_generation: 2,
                    candidates: vec!["same.raw".into()],
                    memory_pressure: false,
                    workload_busy: false,
                })
                .len(),
            1
        );
        let report = coordinator.report();
        assert_eq!(report.prefetch_cancelled, 1);
        assert_eq!(report.prefetch_completed, 1);
    }

    #[test]
    fn foreground_miss_releases_cancelled_prefetch_for_rescheduling() {
        let coordinator = ImageOpenCoordinator::default();
        let first = coordinator.schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 1,
            candidates: vec!["prefetch.raw".into()],
            memory_pressure: false,
            workload_busy: false,
        });
        let first_identity = first[0].identity;
        let foreground = ImageOpenSessionId {
            selection_generation: 1,
            image_session: 1,
        };
        assert!(
            coordinator
                .begin_foreground(&foreground, "foreground.raw")
                .unwrap()
                .is_none()
        );

        let replacement = coordinator.schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 1,
            candidates: vec!["prefetch.raw".into()],
            memory_pressure: false,
            workload_busy: false,
        });
        assert_eq!(replacement.len(), 1);
        coordinator.finish_prefetch("prefetch.raw", first_identity, false);
        assert!(
            coordinator
                .schedule(&ScheduleImagePrefetchRequest {
                    collection_generation: 1,
                    candidates: vec!["prefetch.raw".into()],
                    memory_pressure: false,
                    workload_busy: false,
                })
                .is_empty()
        );
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
        let first_token = first[0].identity.cancellation_generation;
        let second = coordinator.schedule(&ScheduleImagePrefetchRequest {
            collection_generation: 2,
            candidates: vec!["new.raw".into()],
            memory_pressure: false,
            workload_busy: false,
        });
        assert_ne!(first_token, second[0].identity.cancellation_generation);

        let session = ImageOpenSessionId {
            selection_generation: 1,
            image_session: 1,
        };
        coordinator
            .begin_foreground(&session, "foreground.raw")
            .unwrap();
        assert_ne!(
            second[0].identity.cancellation_generation,
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

    #[test]
    fn frame_sequence_is_monotonic_and_settled_blocks_late_provisional() {
        let coordinator = ImageOpenCoordinator::default();
        let session = ImageOpenSessionId {
            selection_generation: 7,
            image_session: 7,
        };
        coordinator.begin_foreground(&session, "a.raw").unwrap();
        assert_eq!(
            coordinator.claim_frame(&session, "a.raw", ImageFrameQuality::EmbeddedProvisional),
            Some(1)
        );
        assert_eq!(
            coordinator.claim_frame(&session, "a.raw", ImageFrameQuality::SettledDeveloped),
            Some(2)
        );
        assert_eq!(
            coordinator.claim_frame(&session, "a.raw", ImageFrameQuality::EmbeddedProvisional),
            None
        );
        assert_eq!(coordinator.report().embedded_preview_stale_suppressed, 1);
    }

    #[test]
    fn superseded_session_cannot_publish_any_frame() {
        let coordinator = ImageOpenCoordinator::default();
        let old = ImageOpenSessionId {
            selection_generation: 1,
            image_session: 1,
        };
        let current = ImageOpenSessionId {
            selection_generation: 2,
            image_session: 2,
        };
        coordinator.begin_foreground(&old, "a.raw").unwrap();
        coordinator.begin_foreground(&current, "b.raw").unwrap();
        assert_eq!(
            coordinator.claim_frame(&old, "a.raw", ImageFrameQuality::EmbeddedProvisional),
            None
        );
        assert_eq!(
            coordinator.claim_frame(&old, "a.raw", ImageFrameQuality::SettledDeveloped),
            None
        );
    }

    #[test]
    fn injected_slow_provisional_cannot_publish_after_fast_settled() {
        let coordinator = ImageOpenCoordinator::default();
        let session = ImageOpenSessionId {
            selection_generation: 9,
            image_session: 9,
        };
        coordinator.begin_foreground(&session, "race.raw").unwrap();
        let worker = coordinator.clone();
        let worker_session = session.clone();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let provisional = std::thread::spawn(move || {
            release_rx.recv().unwrap();
            worker.claim_frame(
                &worker_session,
                "race.raw",
                ImageFrameQuality::EmbeddedProvisional,
            )
        });
        assert_eq!(
            coordinator.claim_frame(&session, "race.raw", ImageFrameQuality::SettledDeveloped),
            Some(1)
        );
        release_tx.send(()).unwrap();
        assert_eq!(provisional.join().unwrap(), None);
    }

    #[test]
    fn injected_fast_provisional_is_followed_by_newer_slow_settled() {
        let coordinator = ImageOpenCoordinator::default();
        let session = ImageOpenSessionId {
            selection_generation: 10,
            image_session: 10,
        };
        coordinator.begin_foreground(&session, "race.raw").unwrap();
        assert_eq!(
            coordinator.claim_frame(&session, "race.raw", ImageFrameQuality::EmbeddedProvisional,),
            Some(1)
        );
        let worker = coordinator;
        let worker_session = session;
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let settled = std::thread::spawn(move || {
            release_rx.recv().unwrap();
            worker.claim_frame(
                &worker_session,
                "race.raw",
                ImageFrameQuality::SettledDeveloped,
            )
        });
        release_tx.send(()).unwrap();
        assert_eq!(settled.join().unwrap(), Some(2));
    }

    #[test]
    fn embedded_cache_is_revision_keyed_and_shared_by_virtual_copies() {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), b"revision-a").unwrap();
        let coordinator = ImageOpenCoordinator::default();
        let preview = ExtractedEmbeddedPreview {
            candidate_height: 768,
            candidate_width: 1024,
            data_url: "data:image/jpeg;base64,AAAA".to_string(),
            receipt: ProgressiveImageFrameReceipt {
                image_session: 1,
                selection_generation: 1,
                source_revision: crate::source_revision::SourceRevision::from_path(file.path())
                    .unwrap()
                    .identity(),
                frame_generation: 1,
                quality: ImageFrameQuality::EmbeddedProvisional,
                width: 1024,
                height: 768,
                orientation_applied: false,
                source_kind: "fixture".to_string(),
                color_assumption: "encoded_srgb_vendor_preview".to_string(),
                provisional_reason: Some("not authoritative".to_string()),
            },
            elapsed_millis: 1,
            encoded_bytes: 4,
        };
        coordinator.cache_embedded_preview(file.path(), preview);
        assert!(coordinator.cached_embedded_preview(file.path()).is_some());
        assert_eq!(coordinator.report().embedded_preview_cache_hits, 1);

        std::fs::write(file.path(), b"revision-b-is-different").unwrap();
        assert!(coordinator.cached_embedded_preview(file.path()).is_none());
    }
}
