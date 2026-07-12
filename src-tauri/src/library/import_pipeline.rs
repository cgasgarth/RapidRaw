use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures::{StreamExt, stream};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

use super::file_management::{ImportSettings, generate_filename_from_template, parse_virtual_path};

const COPY_BUFFER_BYTES: usize = 1024 * 1024;
const METADATA_CONCURRENCY: usize = 4;
const FAST_DEVICE_COPY_CONCURRENCY: usize = 4;
const SAME_DEVICE_COPY_CONCURRENCY: usize = 2;
const RESOURCE_BUFFER_CREDITS: usize = 8;
const JOURNAL_SCHEMA_VERSION: u32 = 1;
static IMPORT_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const _: () = assert!(SAME_DEVICE_COPY_CONCURRENCY < FAST_DEVICE_COPY_CONCURRENCY);
const _: () = assert!(FAST_DEVICE_COPY_CONCURRENCY <= RESOURCE_BUFFER_CREDITS);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImportStage {
    Preflight,
    Inspecting,
    Copying,
    Verifying,
    Committing,
    DeletingSource,
    Cataloging,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportArtifactPlan {
    pub source: PathBuf,
    pub destination: PathBuf,
    pub required: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRevision {
    pub byte_size: u64,
    pub modified_millis: u128,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItemPlan {
    pub item_id: u64,
    pub source: PathBuf,
    pub source_revision: SourceRevision,
    pub destination: PathBuf,
    pub artifacts: Vec<ImportArtifactPlan>,
    pub expected_bytes: u64,
    pub delete_source_after_commit: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportArtifactReceipt {
    pub destination: String,
    pub byte_size: u64,
    pub blake3: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItemReceipt {
    pub item_id: u64,
    pub source: String,
    pub destination: String,
    pub artifacts: Vec<ImportArtifactReceipt>,
    pub source_deleted: bool,
    pub source_delete_error: Option<String>,
    pub committed_at_millis: u128,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItemFailure {
    pub item_id: u64,
    pub source: String,
    pub stage: ImportStage,
    pub error: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDiagnostics {
    pub preflight_millis: u64,
    pub time_to_first_commit_millis: Option<u64>,
    pub cancellation_latency_millis: Option<u64>,
    pub metadata_concurrency: usize,
    pub copy_concurrency: usize,
    pub max_copy_in_flight: usize,
    pub max_buffered_bytes: u64,
    pub progress_events: u64,
    pub full_refreshes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJobReceipt {
    pub schema_version: u32,
    pub job_id: String,
    pub completed: Vec<ImportItemReceipt>,
    pub failed: Vec<ImportItemFailure>,
    pub cancelled: Vec<u64>,
    pub total_bytes: u64,
    pub diagnostics: ImportDiagnostics,
    pub terminal_stage: ImportStage,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportJobJournal {
    schema_version: u32,
    job_id: String,
    destination_folder: String,
    settings: ImportSettings,
    plans: Vec<ImportItemPlan>,
    receipt: ImportJobReceipt,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProgressEvent {
    job_id: String,
    stage: ImportStage,
    current: usize,
    total: usize,
    path: String,
    inspected: usize,
    copying: usize,
    committed: usize,
    failed: usize,
    cancelled: usize,
    bytes_copied: u64,
    total_bytes: u64,
    committed_path: Option<String>,
}

#[derive(Default)]
struct PipelineCounters {
    inspected: AtomicUsize,
    committed: AtomicUsize,
    failed: AtomicUsize,
    cancelled: AtomicUsize,
    bytes_copied: AtomicU64,
    copy_in_flight: AtomicUsize,
    max_copy_in_flight: AtomicUsize,
    progress_events: AtomicU64,
}

#[derive(Clone)]
pub struct ImportPipeline {
    app: AppHandle,
    job_id: String,
    destination_folder: PathBuf,
    settings: ImportSettings,
    cancellation: Arc<AtomicBool>,
    counters: Arc<PipelineCounters>,
    buffer_credits: Arc<Semaphore>,
}

impl ImportPipeline {
    pub fn new(
        app: AppHandle,
        job_id: String,
        destination_folder: PathBuf,
        settings: ImportSettings,
        cancellation: Arc<AtomicBool>,
    ) -> Self {
        Self {
            app,
            job_id,
            destination_folder,
            settings,
            cancellation,
            counters: Arc::new(PipelineCounters::default()),
            buffer_credits: Arc::new(Semaphore::new(RESOURCE_BUFFER_CREDITS)),
        }
    }

    pub async fn run(self, source_paths: Vec<String>) -> ImportJobReceipt {
        let started = Instant::now();
        let preflight_started = Instant::now();
        self.emit_progress(ImportStage::Preflight, source_paths.len(), "", 0, None);
        let plans = match self.preflight(source_paths).await {
            Ok(plans) => plans,
            Err(failures) => {
                let cancelled_ids: Vec<u64> = failures
                    .iter()
                    .filter(|failure| failure.stage == ImportStage::Cancelled)
                    .map(|failure| failure.item_id)
                    .collect();
                let was_cancelled = self.cancellation.load(Ordering::Acquire);
                let mut receipt = ImportJobReceipt {
                    schema_version: JOURNAL_SCHEMA_VERSION,
                    job_id: self.job_id.clone(),
                    completed: Vec::new(),
                    failed: if was_cancelled { Vec::new() } else { failures },
                    cancelled: cancelled_ids,
                    total_bytes: 0,
                    diagnostics: ImportDiagnostics {
                        preflight_millis: preflight_started.elapsed().as_millis() as u64,
                        metadata_concurrency: METADATA_CONCURRENCY,
                        ..ImportDiagnostics::default()
                    },
                    terminal_stage: if was_cancelled {
                        ImportStage::Cancelled
                    } else {
                        ImportStage::Failed
                    },
                };
                self.finish(&[], &mut receipt);
                return receipt;
            }
        };
        let preflight_millis = preflight_started.elapsed().as_millis() as u64;
        let total_bytes = plans.iter().map(|plan| plan.expected_bytes).sum();
        let total_items = plans.len();
        let copy_concurrency = copy_concurrency_for(&plans, &self.destination_folder);
        let completed = Arc::new(Mutex::new(Vec::new()));
        let failed = Arc::new(Mutex::new(Vec::new()));
        let cancelled = Arc::new(Mutex::new(Vec::new()));
        let first_commit = Arc::new(Mutex::new(None::<Duration>));

        stream::iter(plans.clone())
            .for_each_concurrent(copy_concurrency, |plan| {
                let pipeline = self.clone();
                let completed = Arc::clone(&completed);
                let failed = Arc::clone(&failed);
                let cancelled = Arc::clone(&cancelled);
                let first_commit = Arc::clone(&first_commit);
                async move {
                    if pipeline.cancellation.load(Ordering::Acquire) {
                        cancelled.lock().unwrap().push(plan.item_id);
                        pipeline.counters.cancelled.fetch_add(1, Ordering::Relaxed);
                        return;
                    }
                    match pipeline.process_item(&plan, total_items, total_bytes).await {
                        Ok(receipt) => {
                            let mut first = first_commit.lock().unwrap();
                            if first.is_none() {
                                *first = Some(started.elapsed());
                            }
                            completed.lock().unwrap().push(receipt);
                        }
                        Err(failure) if failure.stage == ImportStage::Cancelled => {
                            cancelled.lock().unwrap().push(plan.item_id);
                            pipeline.counters.cancelled.fetch_add(1, Ordering::Relaxed);
                        }
                        Err(failure) => {
                            pipeline.counters.failed.fetch_add(1, Ordering::Relaxed);
                            failed.lock().unwrap().push(failure);
                        }
                    }
                }
            })
            .await;

        let mut completed = Arc::try_unwrap(completed).unwrap().into_inner().unwrap();
        let mut failed = Arc::try_unwrap(failed).unwrap().into_inner().unwrap();
        let mut cancelled = Arc::try_unwrap(cancelled).unwrap().into_inner().unwrap();
        completed.sort_by_key(|item| item.item_id);
        failed.sort_by_key(|item| item.item_id);
        cancelled.sort_unstable();
        let terminal_stage = if self.cancellation.load(Ordering::Acquire) {
            ImportStage::Cancelled
        } else if failed.is_empty() {
            ImportStage::Completed
        } else {
            ImportStage::Failed
        };
        let first_commit_millis = first_commit
            .lock()
            .unwrap()
            .map(|duration| duration.as_millis() as u64);
        let mut receipt = ImportJobReceipt {
            schema_version: JOURNAL_SCHEMA_VERSION,
            job_id: self.job_id.clone(),
            completed,
            failed,
            cancelled,
            total_bytes,
            diagnostics: ImportDiagnostics {
                preflight_millis,
                time_to_first_commit_millis: first_commit_millis,
                cancellation_latency_millis: self
                    .cancellation
                    .load(Ordering::Acquire)
                    .then(|| started.elapsed().as_millis() as u64),
                metadata_concurrency: METADATA_CONCURRENCY,
                copy_concurrency,
                max_copy_in_flight: self.counters.max_copy_in_flight.load(Ordering::Relaxed),
                max_buffered_bytes: RESOURCE_BUFFER_CREDITS as u64 * COPY_BUFFER_BYTES as u64,
                progress_events: self.counters.progress_events.load(Ordering::Relaxed),
                full_refreshes: 0,
            },
            terminal_stage,
        };
        self.finish(&plans, &mut receipt);
        receipt
    }

    async fn preflight(
        &self,
        source_paths: Vec<String>,
    ) -> Result<Vec<ImportItemPlan>, Vec<ImportItemFailure>> {
        let total = source_paths.len();
        let destination = self.destination_folder.clone();
        let settings = self.settings.clone();
        let counters = Arc::clone(&self.counters);
        let cancellation = Arc::clone(&self.cancellation);
        let results = stream::iter(source_paths.into_iter().enumerate())
            .map(|(index, source_path)| {
                let destination = destination.clone();
                let settings = settings.clone();
                let counters = Arc::clone(&counters);
                let cancellation = Arc::clone(&cancellation);
                async move {
                    if cancellation.load(Ordering::Acquire) {
                        return Err(item_failure(
                            index as u64,
                            &source_path,
                            ImportStage::Cancelled,
                            "import cancelled during preflight",
                        ));
                    }
                    let result = tokio::task::spawn_blocking(move || {
                        inspect_source(index, total, &source_path, &destination, &settings)
                    })
                    .await
                    .map_err(|error| {
                        item_failure(
                            index as u64,
                            "",
                            ImportStage::Inspecting,
                            &format!("metadata worker failed: {error}"),
                        )
                    })?;
                    counters.inspected.fetch_add(1, Ordering::Relaxed);
                    result
                }
            })
            .buffer_unordered(METADATA_CONCURRENCY)
            .collect::<Vec<_>>()
            .await;

        let mut plans = Vec::with_capacity(results.len());
        let mut failures = Vec::new();
        for result in results {
            match result {
                Ok(plan) => plans.push(plan),
                Err(failure) => failures.push(failure),
            }
        }
        plans.sort_by_key(|plan| plan.item_id);
        failures.extend(validate_plan_set(&plans));
        if failures.is_empty() {
            Ok(plans)
        } else {
            Err(failures)
        }
    }

    async fn process_item(
        &self,
        plan: &ImportItemPlan,
        total: usize,
        total_bytes: u64,
    ) -> Result<ImportItemReceipt, ImportItemFailure> {
        if self.cancellation.load(Ordering::Acquire) {
            return Err(item_failure(
                plan.item_id,
                &plan.source.to_string_lossy(),
                ImportStage::Cancelled,
                "import cancelled before copy",
            ));
        }
        let _credit = self
            .buffer_credits
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| {
                item_failure(
                    plan.item_id,
                    &plan.source.to_string_lossy(),
                    ImportStage::Cancelled,
                    "resource credits closed",
                )
            })?;
        let in_flight = self.counters.copy_in_flight.fetch_add(1, Ordering::Relaxed) + 1;
        self.counters
            .max_copy_in_flight
            .fetch_max(in_flight, Ordering::Relaxed);
        self.emit_progress(
            ImportStage::Copying,
            total,
            &plan.source.to_string_lossy(),
            total_bytes,
            None,
        );
        let plan_owned = plan.clone();
        let cancellation = Arc::clone(&self.cancellation);
        let counters = Arc::clone(&self.counters);
        let result = tokio::task::spawn_blocking(move || {
            copy_and_commit_item(&plan_owned, &cancellation, &counters)
        })
        .await
        .map_err(|error| {
            item_failure(
                plan.item_id,
                &plan.source.to_string_lossy(),
                ImportStage::Copying,
                &format!("copy worker failed: {error}"),
            )
        })?;
        self.counters.copy_in_flight.fetch_sub(1, Ordering::Relaxed);
        let mut receipt = result?;
        self.persist_partial_journal(plan, &receipt);
        let authored_changes = receipt
            .artifacts
            .iter()
            .map(|artifact| super::changefeed::LibraryPathChange::Added {
                path: artifact.destination.clone(),
            })
            .collect();
        let changefeed = self
            .app
            .state::<super::changefeed::LibraryFilesystemChangefeed>();
        if let Err(error) = changefeed.publish_authored_changes(&self.app, authored_changes) {
            log::warn!(
                "Failed to publish committed import {} to the catalog changefeed: {error}",
                plan.item_id
            );
        }
        if plan.delete_source_after_commit {
            self.emit_progress(
                ImportStage::DeletingSource,
                total,
                &plan.source.to_string_lossy(),
                total_bytes,
                None,
            );
            if self.cancellation.load(Ordering::Acquire) {
                receipt.source_delete_error = Some("cancelled before source deletion".to_string());
            } else {
                let (source_deleted, delete_error) = delete_committed_sources(plan);
                receipt.source_deleted = source_deleted;
                receipt.source_delete_error = delete_error;
            }
        }
        self.counters.committed.fetch_add(1, Ordering::Relaxed);
        self.emit_progress(
            ImportStage::Cataloging,
            total,
            &plan.source.to_string_lossy(),
            total_bytes,
            Some(plan.destination.to_string_lossy().into_owned()),
        );
        Ok(receipt)
    }

    fn emit_progress(
        &self,
        stage: ImportStage,
        total: usize,
        path: &str,
        total_bytes: u64,
        committed_path: Option<String>,
    ) {
        self.counters
            .progress_events
            .fetch_add(1, Ordering::Relaxed);
        let committed = self.counters.committed.load(Ordering::Relaxed);
        let failed = self.counters.failed.load(Ordering::Relaxed);
        let event = ImportProgressEvent {
            job_id: self.job_id.clone(),
            stage,
            current: committed + failed,
            total,
            path: path.to_string(),
            inspected: self.counters.inspected.load(Ordering::Relaxed),
            copying: self.counters.copy_in_flight.load(Ordering::Relaxed),
            committed,
            failed,
            cancelled: self.counters.cancelled.load(Ordering::Relaxed),
            bytes_copied: self.counters.bytes_copied.load(Ordering::Relaxed),
            total_bytes,
            committed_path,
        };
        let _ = self.app.emit(crate::events::IMPORT_PROGRESS, event);
    }

    fn finish(&self, plans: &[ImportItemPlan], receipt: &mut ImportJobReceipt) {
        let _ = write_journal(
            &self.app,
            &ImportJobJournal {
                schema_version: JOURNAL_SCHEMA_VERSION,
                job_id: self.job_id.clone(),
                destination_folder: self.destination_folder.to_string_lossy().into_owned(),
                settings: self.settings.clone(),
                plans: plans.to_vec(),
                receipt: receipt.clone(),
            },
        );
        self.emit_progress(
            receipt.terminal_stage.clone(),
            plans.len(),
            "",
            receipt.total_bytes,
            None,
        );
        let _ = self
            .app
            .emit(crate::events::IMPORT_RECEIPT, receipt.clone());
        match receipt.terminal_stage {
            ImportStage::Completed => {
                let _ = self
                    .app
                    .emit(crate::events::IMPORT_COMPLETE, receipt.clone());
            }
            ImportStage::Cancelled => {
                let _ = self
                    .app
                    .emit(crate::events::IMPORT_CANCELLED, receipt.clone());
            }
            _ => {
                let message = receipt
                    .failed
                    .first()
                    .map(|failure| failure.error.clone())
                    .unwrap_or_else(|| "Import failed".to_string());
                let _ = self.app.emit(crate::events::IMPORT_ERROR, message);
            }
        }
    }

    fn persist_partial_journal(&self, plan: &ImportItemPlan, receipt: &ImportItemReceipt) {
        let path = journal_dir(&self.app).join(format!("{}.items.jsonl", self.job_id));
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path)
            && let Ok(line) = serde_json::to_string(&(plan, receipt))
        {
            let _ = writeln!(file, "{line}");
            let _ = file.sync_data();
        }
    }
}

fn validate_plan_set(plans: &[ImportItemPlan]) -> Vec<ImportItemFailure> {
    let mut failures = Vec::new();
    let mut destinations = HashSet::new();
    let mut sources = HashSet::new();
    for plan in plans {
        let canonical_source = plan
            .source
            .canonicalize()
            .unwrap_or_else(|_| plan.source.clone());
        if !sources.insert(canonical_source) {
            failures.push(item_failure(
                plan.item_id,
                &plan.source.to_string_lossy(),
                ImportStage::Preflight,
                "duplicate source in import request",
            ));
        }
        for destination in std::iter::once(&plan.destination)
            .chain(plan.artifacts.iter().map(|artifact| &artifact.destination))
        {
            if destination.exists() || !destinations.insert(destination.clone()) {
                failures.push(item_failure(
                    plan.item_id,
                    &plan.source.to_string_lossy(),
                    ImportStage::Preflight,
                    &format!("destination collision: {}", destination.display()),
                ));
            }
        }
    }
    failures
}

fn inspect_source(
    index: usize,
    total: usize,
    source_path_str: &str,
    destination_folder: &Path,
    settings: &ImportSettings,
) -> Result<ImportItemPlan, ImportItemFailure> {
    #[cfg(target_os = "android")]
    if crate::android_integration::is_android_content_uri(source_path_str) {
        let resolved_name = crate::android_integration::resolve_android_content_uri_name(
            source_path_str,
        )
        .map_err(|error| {
            item_failure(
                index as u64,
                source_path_str,
                ImportStage::Inspecting,
                &error,
            )
        })?;
        let resolved_path = PathBuf::from(&resolved_name);
        let file_date = chrono::Utc::now();
        let mut final_folder = destination_folder.to_path_buf();
        if settings.organize_by_date {
            let format = settings
                .date_folder_format
                .replace("YYYY", "%Y")
                .replace("MM", "%m")
                .replace("DD", "%d");
            final_folder.push(file_date.format(&format).to_string());
        }
        let stem = generate_filename_from_template(
            &settings.filename_template,
            &resolved_path,
            index + 1,
            total,
            &file_date,
        );
        let extension = resolved_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        return Ok(ImportItemPlan {
            item_id: index as u64,
            source: PathBuf::from(source_path_str),
            source_revision: SourceRevision {
                byte_size: 0,
                modified_millis: 0,
            },
            destination: final_folder.join(if extension.is_empty() {
                stem
            } else {
                format!("{stem}.{extension}")
            }),
            artifacts: Vec::new(),
            expected_bytes: 0,
            delete_source_after_commit: false,
        });
    }
    let (source, virtual_sidecar) = parse_virtual_path(source_path_str);
    let metadata = source.metadata().map_err(|error| {
        item_failure(
            index as u64,
            source_path_str,
            ImportStage::Inspecting,
            &format!("source unavailable: {error}"),
        )
    })?;
    if !metadata.is_file() {
        return Err(item_failure(
            index as u64,
            source_path_str,
            ImportStage::Preflight,
            "source is not a regular file",
        ));
    }
    let file_date = crate::exif_processing::get_creation_date_from_path(&source);
    let mut final_folder = destination_folder.to_path_buf();
    if settings.organize_by_date {
        let format = settings
            .date_folder_format
            .replace("YYYY", "%Y")
            .replace("MM", "%m")
            .replace("DD", "%d");
        final_folder.push(file_date.format(&format).to_string());
    }
    let stem = generate_filename_from_template(
        &settings.filename_template,
        &source,
        index + 1,
        total,
        &file_date,
    );
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let destination = final_folder.join(if extension.is_empty() {
        stem
    } else {
        format!("{stem}.{extension}")
    });
    let artifacts = associated_sidecars(&source, &virtual_sidecar, &destination);
    let expected_bytes = metadata.len()
        + artifacts
            .iter()
            .filter_map(|artifact| artifact.source.metadata().ok().map(|meta| meta.len()))
            .sum::<u64>();
    Ok(ImportItemPlan {
        item_id: index as u64,
        source,
        source_revision: source_revision(&metadata),
        destination,
        artifacts,
        expected_bytes,
        delete_source_after_commit: settings.delete_after_import,
    })
}

fn associated_sidecars(
    source: &Path,
    virtual_sidecar: &Path,
    destination: &Path,
) -> Vec<ImportArtifactPlan> {
    let mut candidates = vec![
        crate::exif_processing::get_primary_sidecar_path(source),
        crate::exif_processing::get_rrexif_path(source),
        source.with_extension("xmp"),
    ];
    if virtual_sidecar != crate::exif_processing::get_primary_sidecar_path(source) {
        candidates.push(virtual_sidecar.to_path_buf());
    }
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| path.exists() && seen.insert(path.clone()))
        .map(|path| {
            let xmp_source = source.with_extension("xmp");
            if path == xmp_source {
                return ImportArtifactPlan {
                    source: path,
                    destination: destination.with_extension("xmp"),
                    required: true,
                };
            }
            let suffix = path
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| {
                    source
                        .file_name()?
                        .to_str()
                        .map(|source_name| (name, source_name))
                })
                .and_then(|(name, source_name)| name.strip_prefix(source_name))
                .unwrap_or(".rrdata")
                .to_string();
            ImportArtifactPlan {
                source: path,
                destination: destination.with_file_name(format!(
                    "{}{}",
                    destination
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    suffix
                )),
                required: true,
            }
        })
        .collect()
}

fn copy_and_commit_item(
    plan: &ImportItemPlan,
    cancellation: &AtomicBool,
    counters: &PipelineCounters,
) -> Result<ImportItemReceipt, ImportItemFailure> {
    if let Some(parent) = plan.destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            item_failure(
                plan.item_id,
                &plan.source.to_string_lossy(),
                ImportStage::Copying,
                &format!("destination directory failed: {error}"),
            )
        })?;
    }
    let mut artifacts = Vec::with_capacity(plan.artifacts.len() + 1);
    let mut committed_paths = Vec::new();
    for (source, destination) in std::iter::once((&plan.source, &plan.destination)).chain(
        plan.artifacts
            .iter()
            .map(|artifact| (&artifact.source, &artifact.destination)),
    ) {
        match stream_copy_atomic(source, destination, cancellation, counters) {
            Ok(receipt) => {
                committed_paths.push(destination.clone());
                artifacts.push(receipt);
            }
            Err((stage, error)) => {
                for path in committed_paths {
                    let _ = fs::remove_file(path);
                }
                return Err(item_failure(
                    plan.item_id,
                    &plan.source.to_string_lossy(),
                    stage,
                    &error,
                ));
            }
        }
    }
    Ok(ImportItemReceipt {
        item_id: plan.item_id,
        source: plan.source.to_string_lossy().into_owned(),
        destination: plan.destination.to_string_lossy().into_owned(),
        artifacts,
        source_deleted: false,
        source_delete_error: None,
        committed_at_millis: now_millis(),
    })
}

fn stream_copy_atomic(
    source: &Path,
    destination: &Path,
    cancellation: &AtomicBool,
    counters: &PipelineCounters,
) -> Result<ImportArtifactReceipt, (ImportStage, String)> {
    let temp_sequence = IMPORT_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temp = destination.with_file_name(format!(
        ".rawengine-tmp-import-{}-{}-{}",
        std::process::id(),
        now_millis(),
        temp_sequence,
    ));
    let result = (|| {
        #[cfg(target_os = "android")]
        if crate::android_integration::is_android_content_uri(&source.to_string_lossy()) {
            let (bytes, digest) = crate::android_integration::stream_android_content_uri_to_path(
                &source.to_string_lossy(),
                &temp,
                cancellation,
            )
            .map_err(|error| (ImportStage::Copying, error))?;
            counters.bytes_copied.fetch_add(bytes, Ordering::Relaxed);
            if cancellation.load(Ordering::Acquire) {
                return Err((
                    ImportStage::Cancelled,
                    "cancelled before commit".to_string(),
                ));
            }
            fs::rename(&temp, destination)
                .map_err(|error| (ImportStage::Committing, error.to_string()))?;
            return Ok(ImportArtifactReceipt {
                destination: destination.to_string_lossy().into_owned(),
                byte_size: bytes,
                blake3: digest,
            });
        }
        let input =
            File::open(source).map_err(|error| (ImportStage::Copying, error.to_string()))?;
        let output =
            File::create(&temp).map_err(|error| (ImportStage::Copying, error.to_string()))?;
        let mut reader = BufReader::with_capacity(COPY_BUFFER_BYTES, input);
        let mut writer = BufWriter::with_capacity(COPY_BUFFER_BYTES, output);
        let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
        let mut hasher = blake3::Hasher::new();
        let mut bytes = 0_u64;
        loop {
            if cancellation.load(Ordering::Acquire) {
                return Err((ImportStage::Cancelled, "copy cancelled".to_string()));
            }
            let read = reader
                .read(&mut buffer)
                .map_err(|error| (ImportStage::Copying, error.to_string()))?;
            if read == 0 {
                break;
            }
            writer
                .write_all(&buffer[..read])
                .map_err(|error| (ImportStage::Copying, error.to_string()))?;
            hasher.update(&buffer[..read]);
            bytes += read as u64;
            counters
                .bytes_copied
                .fetch_add(read as u64, Ordering::Relaxed);
        }
        writer
            .flush()
            .map_err(|error| (ImportStage::Verifying, error.to_string()))?;
        writer
            .get_ref()
            .sync_all()
            .map_err(|error| (ImportStage::Verifying, error.to_string()))?;
        let source_size = source
            .metadata()
            .map_err(|error| (ImportStage::Verifying, error.to_string()))?
            .len();
        if source_size != bytes {
            return Err((
                ImportStage::Verifying,
                format!("byte verification failed: expected {source_size}, copied {bytes}"),
            ));
        }
        if cancellation.load(Ordering::Acquire) {
            return Err((
                ImportStage::Cancelled,
                "cancelled before commit".to_string(),
            ));
        }
        fs::rename(&temp, destination)
            .map_err(|error| (ImportStage::Committing, error.to_string()))?;
        Ok(ImportArtifactReceipt {
            destination: destination.to_string_lossy().into_owned(),
            byte_size: bytes,
            blake3: hasher.finalize().to_hex().to_string(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn delete_committed_sources(plan: &ImportItemPlan) -> (bool, Option<String>) {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    let remove = |path: &Path| trash::delete(path).map_err(|error| error.to_string());
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let remove = |path: &Path| fs::remove_file(path).map_err(|error| error.to_string());
    let mut errors = Vec::new();
    let source_deleted = match remove(&plan.source) {
        Ok(()) => true,
        Err(error) => {
            errors.push(format!("{}: {error}", plan.source.display()));
            false
        }
    };
    for artifact in &plan.artifacts {
        if let Err(error) = remove(&artifact.source) {
            errors.push(format!("{}: {error}", artifact.source.display()));
        }
    }
    (
        source_deleted,
        (!errors.is_empty()).then(|| errors.join("; ")),
    )
}

fn copy_concurrency_for(plans: &[ImportItemPlan], destination: &Path) -> usize {
    let destination_device = device_identity(destination.parent().unwrap_or(destination));
    let same_device = destination_device.is_some()
        && plans
            .iter()
            .all(|plan| device_identity(&plan.source) == destination_device);
    if same_device {
        SAME_DEVICE_COPY_CONCURRENCY
    } else {
        FAST_DEVICE_COPY_CONCURRENCY
    }
}

#[cfg(unix)]
fn device_identity(path: &Path) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    path.metadata().ok().map(|metadata| metadata.dev())
}

#[cfg(not(unix))]
fn device_identity(path: &Path) -> Option<u64> {
    path.canonicalize().ok().and_then(|path| {
        path.components().next().map(|component| {
            let mut hasher = blake3::Hasher::new();
            hasher.update(component.as_os_str().to_string_lossy().as_bytes());
            u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
        })
    })
}

fn source_revision(metadata: &fs::Metadata) -> SourceRevision {
    SourceRevision {
        byte_size: metadata.len(),
        modified_millis: metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |duration| duration.as_millis()),
    }
}

fn item_failure(item_id: u64, source: &str, stage: ImportStage, error: &str) -> ImportItemFailure {
    ImportItemFailure {
        item_id,
        source: source.to_string(),
        stage,
        error: error.to_string(),
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn journal_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("rapidraw"))
        .join("import-jobs")
}

fn write_journal(app: &AppHandle, journal: &ImportJobJournal) -> Result<PathBuf, String> {
    let directory = journal_dir(app);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let final_path = directory.join(format!("{}.json", journal.job_id));
    let temp_path = directory.join(format!(".{}.json.tmp", journal.job_id));
    let bytes = serde_json::to_vec_pretty(journal).map_err(|error| error.to_string())?;
    fs::write(&temp_path, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temp_path, &final_path).map_err(|error| error.to_string())?;
    Ok(final_path)
}

pub fn read_job_receipt(app: &AppHandle, job_id: &str) -> Result<ImportJobReceipt, String> {
    let path = journal_dir(app).join(format!("{job_id}.json"));
    let bytes = fs::read(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    let journal: ImportJobJournal =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    Ok(journal.receipt)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResumeValidation {
    pub job_id: String,
    pub verified_completed: Vec<u64>,
    pub resumable: Vec<u64>,
    pub invalid: Vec<ImportItemFailure>,
}

pub fn validate_job_resume(
    app: &AppHandle,
    job_id: &str,
) -> Result<ImportResumeValidation, String> {
    let path = journal_dir(app).join(format!("{job_id}.json"));
    let bytes = fs::read(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    let journal: ImportJobJournal =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    Ok(validate_journal_resume(&journal))
}

fn validate_journal_resume(journal: &ImportJobJournal) -> ImportResumeValidation {
    let completed_by_id: HashMap<u64, &ImportItemReceipt> = journal
        .receipt
        .completed
        .iter()
        .map(|receipt| (receipt.item_id, receipt))
        .collect();
    let mut validation = ImportResumeValidation {
        job_id: journal.job_id.clone(),
        verified_completed: Vec::new(),
        resumable: Vec::new(),
        invalid: Vec::new(),
    };
    for plan in &journal.plans {
        if let Some(receipt) = completed_by_id.get(&plan.item_id) {
            let verified = receipt.artifacts.iter().all(|artifact| {
                let path = Path::new(&artifact.destination);
                path.metadata()
                    .is_ok_and(|metadata| metadata.len() == artifact.byte_size)
                    && hash_path(path).is_ok_and(|digest| digest == artifact.blake3)
            });
            if verified {
                validation.verified_completed.push(plan.item_id);
            } else {
                validation.invalid.push(item_failure(
                    plan.item_id,
                    &plan.source.to_string_lossy(),
                    ImportStage::Verifying,
                    "committed destination no longer matches journal",
                ));
            }
            continue;
        }
        match plan.source.metadata() {
            Ok(metadata)
                if source_revision(&metadata).byte_size == plan.source_revision.byte_size =>
            {
                validation.resumable.push(plan.item_id);
            }
            _ if plan.source.to_string_lossy().starts_with("content://") => {
                validation.resumable.push(plan.item_id);
            }
            _ => validation.invalid.push(item_failure(
                plan.item_id,
                &plan.source.to_string_lossy(),
                ImportStage::Inspecting,
                "source revision changed or source is unavailable",
            )),
        }
    }
    validation.verified_completed.sort_unstable();
    validation.resumable.sort_unstable();
    validation
}

fn hash_path(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::with_capacity(COPY_BUFFER_BYTES, file);
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    let mut hasher = blake3::Hasher::new();
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

pub fn new_job_id() -> String {
    format!("import-{}-{}", now_millis(), std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(source: PathBuf, destination: PathBuf) -> ImportItemPlan {
        let metadata = source.metadata().unwrap();
        ImportItemPlan {
            item_id: 1,
            source,
            source_revision: source_revision(&metadata),
            destination,
            artifacts: Vec::new(),
            expected_bytes: metadata.len(),
            delete_source_after_commit: false,
        }
    }

    #[test]
    fn source_revision_is_deterministic() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        fs::write(temp.path(), b"fixture").unwrap();
        let metadata = temp.path().metadata().unwrap();
        assert_eq!(source_revision(&metadata).byte_size, 7);
        assert_eq!(
            source_revision(&metadata).byte_size,
            source_revision(&metadata).byte_size
        );
    }

    #[test]
    fn preflight_rejects_duplicate_sources_and_destination_collisions() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.raw");
        fs::write(&source, b"source").unwrap();
        let destination = temp.path().join("destination.raw");
        let mut first = plan(source.clone(), destination.clone());
        first.item_id = 0;
        let mut second = plan(source, destination);
        second.item_id = 1;
        let failures = validate_plan_set(&[first, second]);
        assert!(
            failures
                .iter()
                .any(|failure| failure.error.contains("duplicate source"))
        );
        assert!(
            failures
                .iter()
                .any(|failure| failure.error.contains("destination collision"))
        );
    }

    #[test]
    fn sidecar_mapping_preserves_primary_rrexif_and_xmp_associations() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.ARW");
        fs::write(&source, b"raw").unwrap();
        fs::write(
            crate::exif_processing::get_primary_sidecar_path(&source),
            b"rrdata",
        )
        .unwrap();
        fs::write(crate::exif_processing::get_rrexif_path(&source), b"rrexif").unwrap();
        fs::write(source.with_extension("xmp"), b"xmp").unwrap();
        let destination = temp.path().join("renamed.ARW");
        let mapped = associated_sidecars(
            &source,
            &crate::exif_processing::get_primary_sidecar_path(&source),
            &destination,
        );
        let names: HashSet<_> = mapped
            .iter()
            .map(|artifact| {
                artifact
                    .destination
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(
            names,
            HashSet::from([
                "renamed.ARW.rrdata".to_string(),
                "renamed.ARW.rrexif".to_string(),
                "renamed.xmp".to_string(),
            ])
        );
    }

    #[test]
    fn streaming_copy_is_verified_atomic_and_cancellation_cleans_temp() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.raw");
        let destination = temp.path().join("destination.raw");
        let bytes = vec![0x5a; COPY_BUFFER_BYTES * 3 + 17];
        fs::write(&source, &bytes).unwrap();
        let counters = PipelineCounters::default();
        let cancellation = AtomicBool::new(false);
        let receipt = stream_copy_atomic(&source, &destination, &cancellation, &counters).unwrap();
        assert_eq!(receipt.byte_size, bytes.len() as u64);
        assert_eq!(fs::read(&destination).unwrap(), bytes);
        assert_eq!(receipt.blake3, blake3::hash(&bytes).to_hex().to_string());

        let cancelled_destination = temp.path().join("cancelled.raw");
        cancellation.store(true, Ordering::Release);
        assert!(matches!(
            stream_copy_atomic(&source, &cancelled_destination, &cancellation, &counters),
            Err((ImportStage::Cancelled, _))
        ));
        assert!(!cancelled_destination.exists());
        assert_eq!(
            fs::read_dir(temp.path())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".rawengine-tmp"))
                .count(),
            0
        );
    }

    #[test]
    fn concurrent_atomic_copies_do_not_share_temp_paths() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.raw");
        fs::write(&source, vec![0x4a; COPY_BUFFER_BYTES]).unwrap();
        let cancellation = AtomicBool::new(false);
        let counters = PipelineCounters::default();
        let results = std::thread::scope(|scope| {
            let handles = (0..32)
                .map(|index| {
                    let source = source.clone();
                    let destination = temp.path().join(format!("destination-{index}.raw"));
                    let cancellation = &cancellation;
                    let counters = &counters;
                    scope.spawn(move || {
                        stream_copy_atomic(&source, &destination, cancellation, counters)
                    })
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert!(results.iter().all(Result::is_ok));
        assert_eq!(
            fs::read_dir(temp.path())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("destination-"))
                .count(),
            32
        );
        assert_eq!(
            fs::read_dir(temp.path())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".rawengine-tmp-import-"))
                .count(),
            0
        );
    }

    #[test]
    fn artifact_failure_rolls_back_primary_and_preserves_source() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.raw");
        let destination = temp.path().join("destination.raw");
        fs::write(&source, b"raw bytes").unwrap();
        let mut plan = plan(source.clone(), destination.clone());
        plan.artifacts.push(ImportArtifactPlan {
            source: temp.path().join("missing.rrdata"),
            destination: temp.path().join("destination.raw.rrdata"),
            required: true,
        });
        let result =
            copy_and_commit_item(&plan, &AtomicBool::new(false), &PipelineCounters::default());
        assert!(result.is_err());
        assert!(!destination.exists());
        assert!(source.exists());
    }

    #[tokio::test]
    async fn bounded_worker_credits_apply_backpressure_under_slow_writes() {
        let credits = Arc::new(Semaphore::new(2));
        let in_flight = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        stream::iter(0..24)
            .for_each_concurrent(12, |_| {
                let credits = Arc::clone(&credits);
                let in_flight = Arc::clone(&in_flight);
                let peak = Arc::clone(&peak);
                async move {
                    let _permit = credits.acquire_owned().await.unwrap();
                    let active = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(active, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(5)).await;
                    in_flight.fetch_sub(1, Ordering::SeqCst);
                }
            })
            .await;
        assert_eq!(peak.load(Ordering::SeqCst), 2);
        assert_eq!(in_flight.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn resume_validation_rejects_changed_source_revision() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.raw");
        fs::write(&source, b"initial").unwrap();
        let pending = plan(source.clone(), temp.path().join("destination.raw"));
        let journal = ImportJobJournal {
            schema_version: JOURNAL_SCHEMA_VERSION,
            job_id: "resume-fixture".to_string(),
            destination_folder: temp.path().to_string_lossy().into_owned(),
            settings: ImportSettings {
                filename_template: "{original_filename}".to_string(),
                organize_by_date: false,
                date_folder_format: "YYYY/MM/DD".to_string(),
                delete_after_import: false,
            },
            plans: vec![pending],
            receipt: ImportJobReceipt {
                schema_version: JOURNAL_SCHEMA_VERSION,
                job_id: "resume-fixture".to_string(),
                completed: Vec::new(),
                failed: Vec::new(),
                cancelled: vec![1],
                total_bytes: 7,
                diagnostics: ImportDiagnostics::default(),
                terminal_stage: ImportStage::Cancelled,
            },
        };
        fs::write(&source, b"changed source").unwrap();
        let validation = validate_journal_resume(&journal);
        assert!(validation.resumable.is_empty());
        assert_eq!(validation.invalid.len(), 1);
        assert!(
            validation.invalid[0]
                .error
                .contains("source revision changed")
        );
    }
}
