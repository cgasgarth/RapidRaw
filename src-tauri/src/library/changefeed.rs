use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};

pub const LIBRARY_CHANGE_BATCH_EVENT: &str = "library-filesystem-change-batch";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LibraryChangeClass {
    Source,
    Sidecar,
    Xmp,
    Directory,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LibraryPathChange {
    Added {
        path: String,
    },
    Modified {
        path: String,
        class: LibraryChangeClass,
    },
    Removed {
        path: String,
    },
    Renamed {
        old_path: String,
        new_path: String,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryChangeBatch {
    pub watch_generation: u64,
    pub catalog_revision_before: u64,
    pub catalog_revision_after: u64,
    pub root_id: String,
    pub changes: Vec<LibraryPathChange>,
    pub overflowed: bool,
    pub requires_reconcile: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryChangefeedReport {
    pub watched_roots: Vec<String>,
    pub watch_generation: u64,
    pub catalog_revision: u64,
    pub raw_events: u64,
    pub coalesced_operations: u64,
    pub batches: u64,
    pub overflow_count: u64,
    pub queue_peak: usize,
    pub full_recursive_fallback_scans: u64,
}

struct ActiveFeed {
    _watcher: RecommendedWatcher,
    roots: Vec<PathBuf>,
}

#[derive(Default)]
struct ChangefeedInner {
    active: Option<ActiveFeed>,
    generation: u64,
    revision: u64,
    report: LibraryChangefeedReport,
    authored_paths: HashMap<PathBuf, Instant>,
}

#[derive(Clone, Default)]
pub struct LibraryFilesystemChangefeed(Arc<Mutex<ChangefeedInner>>);

fn supported_source(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(crate::formats::is_supported_image_file)
}

fn classify(path: &Path) -> Option<LibraryChangeClass> {
    if path.is_dir() {
        return Some(LibraryChangeClass::Directory);
    }
    let name = path.file_name()?.to_str()?;
    let lower = name.to_ascii_lowercase();
    if supported_source(path) {
        Some(LibraryChangeClass::Source)
    } else if lower.ends_with(".rrdata") || lower.ends_with(".rrexif") {
        Some(LibraryChangeClass::Sidecar)
    } else if lower.ends_with(".xmp") {
        Some(LibraryChangeClass::Xmp)
    } else {
        None
    }
}

fn is_ignored(path: &Path) -> bool {
    if path
        .components()
        .any(|component| component.as_os_str() == ".thumbnails")
    {
        return true;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == ".DS_Store" || name.starts_with(".rawengine-tmp"))
}

fn normalize_ambiguous_rename(
    paths: Vec<PathBuf>,
    exists: impl Fn(&Path) -> bool,
) -> Vec<LibraryPathChange> {
    paths
        .into_iter()
        .filter(|path| !is_ignored(path))
        .filter_map(|path| {
            let class = classify(&path);
            let normalized = super::file_management::source_path_for_library_event(&path)
                .to_string_lossy()
                .into_owned();
            match class {
                Some(class @ (LibraryChangeClass::Sidecar | LibraryChangeClass::Xmp)) => {
                    Some(LibraryPathChange::Modified {
                        path: normalized,
                        class,
                    })
                }
                Some(LibraryChangeClass::Source | LibraryChangeClass::Directory) => {
                    Some(if exists(&path) {
                        LibraryPathChange::Added { path: normalized }
                    } else {
                        LibraryPathChange::Removed { path: normalized }
                    })
                }
                None if !exists(&path) => Some(LibraryPathChange::Removed { path: normalized }),
                None => None,
            }
        })
        .collect()
}

fn normalize_event(event: Event) -> Vec<LibraryPathChange> {
    if matches!(
        event.kind,
        EventKind::Modify(ModifyKind::Name(RenameMode::Any | RenameMode::Other))
    ) {
        return normalize_ambiguous_rename(event.paths, Path::exists);
    }
    if matches!(
        event.kind,
        EventKind::Modify(ModifyKind::Name(RenameMode::From))
    ) {
        return event
            .paths
            .into_iter()
            .filter(|path| !is_ignored(path))
            .map(|path| {
                let class = classify(&path);
                let path = super::file_management::source_path_for_library_event(&path)
                    .to_string_lossy()
                    .into_owned();
                match class {
                    Some(class @ (LibraryChangeClass::Sidecar | LibraryChangeClass::Xmp)) => {
                        LibraryPathChange::Modified { path, class }
                    }
                    _ => LibraryPathChange::Removed { path },
                }
            })
            .collect();
    }
    if matches!(
        event.kind,
        EventKind::Modify(ModifyKind::Name(RenameMode::To))
    ) {
        return event
            .paths
            .into_iter()
            .filter(|path| !is_ignored(path))
            .filter_map(|path| {
                let class = classify(&path)?;
                let path = super::file_management::source_path_for_library_event(&path)
                    .to_string_lossy()
                    .into_owned();
                Some(
                    if matches!(
                        class,
                        LibraryChangeClass::Source | LibraryChangeClass::Directory
                    ) {
                        LibraryPathChange::Added { path }
                    } else {
                        LibraryPathChange::Modified { path, class }
                    },
                )
            })
            .collect();
    }
    if matches!(
        event.kind,
        EventKind::Modify(ModifyKind::Name(RenameMode::Both))
    ) && event.paths.len() >= 2
    {
        let old_path = &event.paths[0];
        let new_path = &event.paths[1];
        if !is_ignored(old_path)
            && !is_ignored(new_path)
            && (classify(old_path).is_some() || classify(new_path).is_some())
        {
            return vec![LibraryPathChange::Renamed {
                old_path: super::file_management::source_path_for_library_event(old_path)
                    .to_string_lossy()
                    .into_owned(),
                new_path: super::file_management::source_path_for_library_event(new_path)
                    .to_string_lossy()
                    .into_owned(),
            }];
        }
    }

    event
        .paths
        .into_iter()
        .filter(|path| !is_ignored(path))
        .filter_map(|path| {
            let class = classify(&path)?;
            let path = super::file_management::source_path_for_library_event(&path)
                .to_string_lossy()
                .into_owned();
            Some(match event.kind {
                EventKind::Create(_)
                    if matches!(
                        class,
                        LibraryChangeClass::Source | LibraryChangeClass::Directory
                    ) =>
                {
                    LibraryPathChange::Added { path }
                }
                EventKind::Remove(_)
                    if matches!(
                        class,
                        LibraryChangeClass::Source | LibraryChangeClass::Directory
                    ) =>
                {
                    LibraryPathChange::Removed { path }
                }
                _ => LibraryPathChange::Modified { path, class },
            })
        })
        .collect()
}

fn change_key(change: &LibraryPathChange) -> String {
    match change {
        LibraryPathChange::Added { path }
        | LibraryPathChange::Modified { path, .. }
        | LibraryPathChange::Removed { path } => path.clone(),
        LibraryPathChange::Renamed { old_path, new_path } => format!("{old_path}\0{new_path}"),
    }
}

fn coalesce_change(existing: LibraryPathChange, incoming: LibraryPathChange) -> LibraryPathChange {
    match (&existing, &incoming) {
        (LibraryPathChange::Removed { .. }, LibraryPathChange::Modified { .. })
        | (LibraryPathChange::Added { .. }, LibraryPathChange::Modified { .. }) => existing,
        (LibraryPathChange::Modified { .. }, LibraryPathChange::Removed { .. })
        | (LibraryPathChange::Modified { .. }, LibraryPathChange::Added { .. }) => incoming,
        _ => incoming,
    }
}

impl LibraryFilesystemChangefeed {
    pub fn publish_authored_changes<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        changes: Vec<LibraryPathChange>,
    ) -> Result<(), String> {
        if changes.is_empty() {
            return Ok(());
        }
        let batch = {
            let mut inner = self
                .0
                .lock()
                .map_err(|_| "changefeed lock poisoned".to_string())?;
            let Some(active) = inner.active.as_ref() else {
                return Ok(());
            };
            let roots = active.roots.clone();
            let changes: Vec<_> = changes
                .into_iter()
                .filter(|change| {
                    change_paths(change).iter().any(|path| {
                        let normalized = path.canonicalize().unwrap_or_else(|_| path.clone());
                        roots.iter().any(|root| normalized.starts_with(root))
                    })
                })
                .collect();
            if changes.is_empty() {
                return Ok(());
            }
            let expires = Instant::now() + Duration::from_secs(3);
            for change in &changes {
                for path in change_paths(change) {
                    let normalized = path.canonicalize().unwrap_or(path);
                    inner.authored_paths.insert(normalized, expires);
                }
            }
            let before = inner.revision;
            inner.revision = inner.revision.saturating_add(1);
            inner.report.catalog_revision = inner.revision;
            inner.report.coalesced_operations = inner
                .report
                .coalesced_operations
                .saturating_add(changes.len() as u64);
            inner.report.batches = inner.report.batches.saturating_add(1);
            LibraryChangeBatch {
                watch_generation: inner.generation,
                catalog_revision_before: before,
                catalog_revision_after: inner.revision,
                root_id: roots
                    .first()
                    .map_or_else(String::new, |path| path.to_string_lossy().into_owned()),
                changes,
                overflowed: false,
                requires_reconcile: false,
            }
        };
        app.emit(LIBRARY_CHANGE_BATCH_EVENT, batch)
            .map_err(|error| error.to_string())
    }

    pub(crate) fn replace_roots<R: Runtime>(
        &self,
        app: AppHandle<R>,
        roots: Vec<PathBuf>,
    ) -> Result<u64, String> {
        let canonical_roots: Vec<PathBuf> = roots
            .into_iter()
            .filter_map(|root| root.canonicalize().ok())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let mut canonical_roots = canonical_roots;
        canonical_roots.sort_unstable();
        let mut inner = self
            .0
            .lock()
            .map_err(|_| "changefeed lock poisoned".to_string())?;
        if inner
            .active
            .as_ref()
            .is_some_and(|active| active.roots == canonical_roots)
        {
            return Ok(inner.generation);
        }
        inner.generation = inner.generation.saturating_add(1);
        let generation = inner.generation;
        let (sender, receiver) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = notify::recommended_watcher(move |result| {
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
        for root in &canonical_roots {
            watcher
                .watch(root, RecursiveMode::Recursive)
                .map_err(|error| format!("Failed to watch {}: {error}", root.display()))?;
        }
        inner.report.watched_roots = canonical_roots
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect();
        inner.report.watch_generation = generation;
        inner.active = Some(ActiveFeed {
            _watcher: watcher,
            roots: canonical_roots.clone(),
        });
        drop(inner);

        let state = self.clone();
        thread::spawn(move || {
            let mut pending = BTreeMap::<String, LibraryPathChange>::new();
            let mut deadline: Option<Instant> = None;
            loop {
                let timeout = deadline.map_or(Duration::from_secs(30), |deadline| {
                    deadline.saturating_duration_since(Instant::now())
                });
                match receiver.recv_timeout(timeout) {
                    Ok(Ok(event)) => {
                        let mut changes = normalize_event(event);
                        if let Ok(mut inner) = state.0.lock() {
                            if inner.generation != generation {
                                break;
                            }
                            inner.report.raw_events = inner.report.raw_events.saturating_add(1);
                            inner.report.queue_peak =
                                inner.report.queue_peak.max(pending.len() + changes.len());
                            let now = Instant::now();
                            inner.authored_paths.retain(|_, expires| *expires > now);
                            changes
                                .retain(|change| !is_authored_echo(change, &inner.authored_paths));
                        }
                        for change in changes {
                            let key = change_key(&change);
                            if let Some(existing) = pending.remove(&key) {
                                pending.insert(key, coalesce_change(existing, change));
                            } else {
                                pending.insert(key, change);
                            }
                        }
                        deadline = Some(Instant::now() + Duration::from_millis(180));
                        if pending.len() >= 1024 {
                            deadline = Some(Instant::now());
                        }
                    }
                    Ok(Err(_)) => {
                        let batch = {
                            let Ok(mut inner) = state.0.lock() else {
                                break;
                            };
                            if inner.generation != generation {
                                break;
                            }
                            inner.report.overflow_count =
                                inner.report.overflow_count.saturating_add(1);
                            let before = inner.revision;
                            inner.revision = inner.revision.saturating_add(1);
                            LibraryChangeBatch {
                                watch_generation: generation,
                                catalog_revision_before: before,
                                catalog_revision_after: inner.revision,
                                root_id: canonical_roots
                                    .first()
                                    .map_or_else(String::new, |p| p.to_string_lossy().into_owned()),
                                changes: Vec::new(),
                                overflowed: true,
                                requires_reconcile: true,
                            }
                        };
                        let _ = app.emit(LIBRARY_CHANGE_BATCH_EVENT, batch);
                        deadline = if pending.is_empty() {
                            None
                        } else {
                            Some(Instant::now())
                        };
                    }
                    Err(RecvTimeoutError::Timeout) if !pending.is_empty() => {
                        let mut changes: Vec<_> =
                            std::mem::take(&mut pending).into_values().collect();
                        deadline = None;
                        let batch = {
                            let Ok(mut inner) = state.0.lock() else {
                                break;
                            };
                            if inner.generation != generation {
                                break;
                            }
                            let now = Instant::now();
                            inner.authored_paths.retain(|_, expires| *expires > now);
                            changes
                                .retain(|change| !is_authored_echo(change, &inner.authored_paths));
                            if changes.is_empty() {
                                continue;
                            }
                            let before = inner.revision;
                            inner.revision = inner.revision.saturating_add(1);
                            inner.report.catalog_revision = inner.revision;
                            inner.report.coalesced_operations = inner
                                .report
                                .coalesced_operations
                                .saturating_add(changes.len() as u64);
                            inner.report.batches = inner.report.batches.saturating_add(1);
                            LibraryChangeBatch {
                                watch_generation: generation,
                                catalog_revision_before: before,
                                catalog_revision_after: inner.revision,
                                root_id: canonical_roots
                                    .first()
                                    .map_or_else(String::new, |p| p.to_string_lossy().into_owned()),
                                changes,
                                overflowed: false,
                                requires_reconcile: false,
                            }
                        };
                        let _ = app.emit(LIBRARY_CHANGE_BATCH_EVENT, batch);
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });
        Ok(generation)
    }
}

fn change_paths(change: &LibraryPathChange) -> Vec<PathBuf> {
    match change {
        LibraryPathChange::Added { path }
        | LibraryPathChange::Modified { path, .. }
        | LibraryPathChange::Removed { path } => vec![PathBuf::from(path)],
        LibraryPathChange::Renamed { old_path, new_path } => {
            vec![PathBuf::from(old_path), PathBuf::from(new_path)]
        }
    }
}

fn is_authored_echo(
    change: &LibraryPathChange,
    authored_paths: &HashMap<PathBuf, Instant>,
) -> bool {
    change_paths(change).iter().any(|path| {
        let normalized = path.canonicalize().unwrap_or_else(|_| path.clone());
        authored_paths.contains_key(&normalized)
    })
}

#[tauri::command]
pub fn configure_library_changefeed(
    app: AppHandle,
    state: State<'_, LibraryFilesystemChangefeed>,
    roots: Vec<String>,
) -> Result<u64, String> {
    state.replace_roots(app, roots.into_iter().map(PathBuf::from).collect())
}

#[tauri::command]
pub fn get_library_changefeed_report(
    state: State<'_, LibraryFilesystemChangefeed>,
) -> Result<LibraryChangefeedReport, String> {
    state
        .0
        .lock()
        .map(|inner| inner.report.clone())
        .map_err(|_| "changefeed lock poisoned".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind};

    #[test]
    fn app_authored_destination_echo_is_suppressed() {
        let path = PathBuf::from("/library/imported.raw");
        let authored = HashMap::from([(path.clone(), Instant::now() + Duration::from_secs(3))]);
        assert!(is_authored_echo(
            &LibraryPathChange::Added {
                path: path.to_string_lossy().into_owned(),
            },
            &authored,
        ));
        assert!(!is_authored_echo(
            &LibraryPathChange::Added {
                path: "/library/other.raw".to_string(),
            },
            &authored,
        ));
    }

    #[test]
    fn repeated_modifies_coalesce_by_path() {
        let path = PathBuf::from("/tmp/photo.ARW");
        let changes = normalize_event(
            Event::new(EventKind::Modify(ModifyKind::Data(
                notify::event::DataChange::Any,
            )))
            .add_path(path),
        );
        let mut pending = BTreeMap::new();
        for change in changes.iter().cloned().chain(changes.clone()) {
            pending.insert(change_key(&change), change);
        }
        assert_eq!(pending.len(), 1);
    }

    #[test]
    fn sidecar_echo_cannot_overwrite_source_removal() {
        let removed = LibraryPathChange::Removed {
            path: "/library/photo.ARW".into(),
        };
        let sidecar = LibraryPathChange::Modified {
            path: "/library/photo.ARW".into(),
            class: LibraryChangeClass::Sidecar,
        };
        assert_eq!(coalesce_change(removed.clone(), sidecar), removed);
    }

    #[test]
    fn sidecar_echo_cannot_overwrite_source_addition() {
        let added = LibraryPathChange::Added {
            path: "/library/photo.ARW".into(),
        };
        let sidecar = LibraryPathChange::Modified {
            path: "/library/photo.ARW".into(),
            class: LibraryChangeClass::Sidecar,
        };
        assert_eq!(coalesce_change(added.clone(), sidecar), added);
    }

    #[test]
    fn filters_unrelated_files_and_keeps_supported_creates() {
        let jpg = normalize_event(
            Event::new(EventKind::Create(CreateKind::File))
                .add_path(PathBuf::from("/tmp/photo.jpg")),
        );
        let text = normalize_event(
            Event::new(EventKind::Create(CreateKind::File))
                .add_path(PathBuf::from("/tmp/notes.txt")),
        );
        assert_eq!(
            jpg,
            vec![LibraryPathChange::Added {
                path: "/tmp/photo.jpg".into()
            }]
        );
        assert!(text.is_empty());
    }

    #[test]
    fn sidecar_noise_normalizes_to_one_source_modification() {
        let changes = normalize_event(
            Event::new(EventKind::Create(CreateKind::File))
                .add_path(PathBuf::from("/library/photo.ARW.rrdata")),
        );
        assert_eq!(
            changes,
            vec![LibraryPathChange::Modified {
                path: "/library/photo.ARW".into(),
                class: LibraryChangeClass::Sidecar,
            }]
        );
    }

    #[test]
    fn paired_native_rename_stays_one_semantic_change() {
        let changes = normalize_event(
            Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
                .add_path(PathBuf::from("/library/old.jpg"))
                .add_path(PathBuf::from("/library/new.jpg")),
        );
        assert_eq!(
            changes,
            vec![LibraryPathChange::Renamed {
                old_path: "/library/old.jpg".into(),
                new_path: "/library/new.jpg".into(),
            }]
        );
    }

    #[test]
    fn split_native_rename_removes_old_source_and_adds_new_source() {
        let from = normalize_event(
            Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::From)))
                .add_path(PathBuf::from("/library/old.ARW")),
        );
        let to = normalize_event(
            Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::To)))
                .add_path(PathBuf::from("/library/new.ARW")),
        );
        assert_eq!(
            from,
            vec![LibraryPathChange::Removed {
                path: "/library/old.ARW".into()
            }]
        );
        assert_eq!(
            to,
            vec![LibraryPathChange::Added {
                path: "/library/new.ARW".into()
            }]
        );
    }

    #[test]
    fn split_sidecar_rename_refreshes_source_instead_of_removing_it() {
        let from = normalize_event(
            Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::From)))
                .add_path(PathBuf::from("/library/photo.ARW.rrdata")),
        );
        assert_eq!(
            from,
            vec![LibraryPathChange::Modified {
                path: "/library/photo.ARW".into(),
                class: LibraryChangeClass::Sidecar,
            }]
        );
    }

    #[test]
    fn ambiguous_paired_rename_uses_existence_to_remove_old_and_add_new() {
        let changes = normalize_ambiguous_rename(
            vec![
                PathBuf::from("/library/old.ARW"),
                PathBuf::from("/library/new.ARW"),
            ],
            |path| path.ends_with("new.ARW"),
        );
        assert_eq!(
            changes,
            vec![
                LibraryPathChange::Removed {
                    path: "/library/old.ARW".into(),
                },
                LibraryPathChange::Added {
                    path: "/library/new.ARW".into(),
                },
            ]
        );
    }

    #[test]
    fn ambiguous_sidecar_rename_refreshes_source_regardless_of_existence() {
        let changes =
            normalize_ambiguous_rename(vec![PathBuf::from("/library/photo.ARW.rrdata")], |_| false);
        assert_eq!(
            changes,
            vec![LibraryPathChange::Modified {
                path: "/library/photo.ARW".into(),
                class: LibraryChangeClass::Sidecar,
            }]
        );
    }

    #[test]
    fn native_source_delete_is_a_catalog_removal() {
        let changes = normalize_event(
            Event::new(EventKind::Remove(notify::event::RemoveKind::File))
                .add_path(PathBuf::from("/library/deleted.ARW")),
        );
        assert_eq!(
            changes,
            vec![LibraryPathChange::Removed {
                path: "/library/deleted.ARW".into(),
            }]
        );
    }

    #[test]
    fn idle_changefeed_has_zero_recursive_fallback_work() {
        let report = LibraryChangefeedReport::default();
        assert_eq!(report.raw_events, 0);
        assert_eq!(report.full_recursive_fallback_scans, 0);
    }

    #[test]
    fn native_backend_reports_real_temp_root_creation_without_polling() {
        let root = tempfile::tempdir().expect("temp root");
        let (sender, receiver) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |event| {
            let _ = sender.send(event);
        })
        .expect("native watcher");
        watcher
            .watch(root.path(), RecursiveMode::Recursive)
            .expect("watch root");
        thread::sleep(Duration::from_millis(500));
        let image_path = root.path().join("external.jpg");
        std::fs::write(&image_path, b"fixture").expect("external create");

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut observed = false;
        while Instant::now() < deadline {
            let Ok(event) = receiver.recv_timeout(Duration::from_millis(250)) else {
                continue;
            };
            let Ok(event) = event else {
                continue;
            };
            if normalize_event(event).iter().any(|change| match change {
                LibraryPathChange::Added { path } | LibraryPathChange::Modified { path, .. } => {
                    path.ends_with("/external.jpg")
                }
                _ => false,
            }) {
                observed = true;
                break;
            }
        }
        assert!(
            observed,
            "native watcher did not report the temp-root image create"
        );
    }

    #[test]
    fn native_backend_rename_and_delete_normalize_to_bounded_catalog_changes() {
        let root = tempfile::tempdir().expect("temp root");
        let old_path = root.path().join("old.ARW");
        let new_path = root.path().join("new.ARW");
        std::fs::write(&old_path, b"fixture").expect("initial source");
        let (sender, receiver) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |event| {
            let _ = sender.send(event);
        })
        .expect("native watcher");
        watcher
            .watch(root.path(), RecursiveMode::Recursive)
            .expect("watch root");
        thread::sleep(Duration::from_millis(500));
        std::fs::rename(&old_path, &new_path).expect("rename source");

        let rename_deadline = Instant::now() + Duration::from_secs(5);
        let mut rename_changes = Vec::new();
        while Instant::now() < rename_deadline {
            let Ok(Ok(event)) = receiver.recv_timeout(Duration::from_millis(250)) else {
                continue;
            };
            eprintln!(
                "native rename event kind={:?} paths={}",
                event.kind,
                event.paths.len()
            );
            rename_changes.extend(normalize_event(event));
            let removed_old = rename_changes.iter().any(|change| matches!(change, LibraryPathChange::Removed { path } if path.ends_with("/old.ARW")));
            let added_new = rename_changes.iter().any(|change| matches!(change, LibraryPathChange::Added { path } if path.ends_with("/new.ARW")));
            let paired = rename_changes.iter().any(|change| matches!(change, LibraryPathChange::Renamed { old_path, new_path } if old_path.ends_with("/old.ARW") && new_path.ends_with("/new.ARW")));
            if paired || (removed_old && added_new) {
                break;
            }
        }
        assert!(rename_changes.iter().any(|change| matches!(change,
            LibraryPathChange::Renamed { old_path, new_path } if old_path.ends_with("/old.ARW") && new_path.ends_with("/new.ARW")
        )) || (rename_changes.iter().any(|change| matches!(change, LibraryPathChange::Removed { path } if path.ends_with("/old.ARW")))
            && rename_changes.iter().any(|change| matches!(change, LibraryPathChange::Added { path } if path.ends_with("/new.ARW")))));

        std::fs::remove_file(&new_path).expect("delete source");
        let delete_deadline = Instant::now() + Duration::from_secs(5);
        let mut removed = false;
        while Instant::now() < delete_deadline {
            let Ok(Ok(event)) = receiver.recv_timeout(Duration::from_millis(250)) else {
                continue;
            };
            eprintln!(
                "native delete event kind={:?} paths={}",
                event.kind,
                event.paths.len()
            );
            if normalize_event(event).iter().any(|change| matches!(change, LibraryPathChange::Removed { path } if path.ends_with("/new.ARW"))) {
                removed = true;
                break;
            }
        }
        assert!(
            removed,
            "native delete did not normalize to a catalog removal"
        );
    }
}
