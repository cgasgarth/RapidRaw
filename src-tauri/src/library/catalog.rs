use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

use super::changefeed::LibraryPathChange;
use super::file_management::{ImageFile, expand_image_file_rows, split_rrdata_sidecar_filename};
use crate::app_settings::load_settings_or_default;
use crate::io::formats::is_supported_image_file;
use crate::io::source_revision::SourceRevision;
use crate::library_identity::read_exif_for_paths_blocking;

const CATALOG_SCHEMA_VERSION: i64 = 1;
const EXIF_PROJECTION_VERSION: i64 = 1;
const EDIT_STATUS_VERSION: i64 = 1;
const DEFAULT_PAGE_SIZE: u32 = 256;
const MAX_PAGE_SIZE: u32 = 2_048;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogImageProjection {
    pub image_id: String,
    pub entity_revision: u64,
    #[serde(flatten)]
    pub image: ImageFile,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCollectionOpened {
    pub session_id: u64,
    pub catalog_revision: u64,
    pub estimated_count: u64,
    pub first_page: Vec<CatalogImageProjection>,
    pub indexing_state: CatalogIndexingState,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCollectionPage {
    pub session_id: u64,
    pub catalog_revision: u64,
    pub rows: Vec<CatalogImageProjection>,
    pub complete: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogIndexingState {
    Current,
    Rebuilt,
    Offline,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCatalogReport {
    pub schema_version: i64,
    pub catalog_id: String,
    pub catalog_revision: u64,
    pub source_count: u64,
    pub entity_count: u64,
    pub folder_count: u64,
    pub warm_query_latency_ms: u64,
    pub first_page_latency_ms: u64,
    pub full_collection_latency_ms: u64,
    pub rows_parsed: u64,
    pub rows_reused: u64,
    pub sidecar_reads: u64,
    pub exif_reads: u64,
    pub transaction_count: u64,
    pub last_batch_size: u64,
    pub corrupt_recovery_count: u64,
    pub migration_rebuild_count: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFolderAggregate {
    pub path: String,
    pub direct_image_count: u64,
    pub recursive_image_count: u64,
    pub child_folder_count: u64,
    pub catalog_revision: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogChangeApplied {
    pub catalog_revision: u64,
    pub upserted: Vec<CatalogImageProjection>,
    pub removed_image_ids: Vec<String>,
}

#[derive(Clone, Debug)]
struct CollectionSession {
    root: String,
    recursive: bool,
    revision: u64,
    next_offset: u64,
    page_size: u32,
    started: Instant,
}

struct CatalogInner {
    connection: Option<Connection>,
    db_path: Option<PathBuf>,
    next_session_id: u64,
    sessions: HashMap<u64, CollectionSession>,
    report: LibraryCatalogReport,
}

impl Default for CatalogInner {
    fn default() -> Self {
        Self {
            connection: None,
            db_path: None,
            next_session_id: 1,
            sessions: HashMap::new(),
            report: LibraryCatalogReport {
                schema_version: CATALOG_SCHEMA_VERSION,
                ..LibraryCatalogReport::default()
            },
        }
    }
}

#[derive(Clone, Default)]
pub struct LibraryCatalog(Arc<Mutex<CatalogInner>>);

fn timestamp_ns(value: Option<SystemTime>) -> u128 {
    value
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_nanos())
}

fn revision_for_path(path: &Path) -> String {
    let Ok(metadata) = fs::metadata(path) else {
        return "missing".into();
    };
    format!(
        "{}:{}",
        metadata.len(),
        timestamp_ns(metadata.modified().ok())
    )
}

fn source_revision_key(path: &Path) -> Result<String, String> {
    let revision = SourceRevision::from_path(path).map_err(|error| error.to_string())?;
    Ok(format!(
        "{}:{}:{}:{}:{}",
        revision.policy,
        revision.byte_len,
        revision.modified_ns,
        revision.file_id.as_ref().map_or(0, |id| id.volume),
        revision.file_id.as_ref().map_or(0, |id| id.file)
    ))
}

fn root_id(path: &Path) -> String {
    blake3::hash(path.to_string_lossy().as_bytes())
        .to_hex()
        .chars()
        .take(16)
        .collect()
}

fn schema_sql() -> &'static str {
    "
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS roots (
      root_path TEXT PRIMARY KEY, root_id TEXT NOT NULL, generation INTEGER NOT NULL,
      indexed INTEGER NOT NULL, catalog_revision INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sources (
      source_path TEXT PRIMARY KEY, root_path TEXT NOT NULL, folder_path TEXT NOT NULL,
      source_revision TEXT NOT NULL, sidecar_revision TEXT NOT NULL, seen_generation INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entities (
      image_id TEXT PRIMARY KEY, source_path TEXT NOT NULL, root_path TEXT NOT NULL,
      folder_path TEXT NOT NULL, entity_json TEXT NOT NULL, entity_revision INTEGER NOT NULL,
      seen_generation INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entities_folder ON entities(folder_path, image_id);
    CREATE INDEX IF NOT EXISTS entities_root ON entities(root_path, folder_path, image_id);
    CREATE TABLE IF NOT EXISTS folders (
      folder_path TEXT PRIMARY KEY, root_path TEXT NOT NULL, direct_image_count INTEGER NOT NULL,
      recursive_image_count INTEGER NOT NULL, child_folder_count INTEGER NOT NULL,
      catalog_revision INTEGER NOT NULL
    );
    "
}

impl LibraryCatalog {
    pub(crate) fn validates_open_revision(
        &self,
        app: &AppHandle,
        image_id: &str,
        expected_catalog_revision: Option<u64>,
        expected_entity_revision: Option<u64>,
    ) -> Result<bool, String> {
        self.with_inner(app, |inner| {
            if expected_catalog_revision
                .is_some_and(|expected| catalog_revision(inner).ok() != Some(expected))
            {
                return Ok(false);
            }
            let Some(expected_entity_revision) = expected_entity_revision else {
                return Ok(true);
            };
            let actual = inner
                .connection
                .as_ref()
                .expect("initialized catalog")
                .query_row(
                    "SELECT entity_revision FROM entities WHERE image_id=?1",
                    params![image_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            Ok(actual == Some(expected_entity_revision as i64))
        })
    }

    fn with_inner<T>(
        &self,
        app: &AppHandle,
        operation: impl FnOnce(&mut CatalogInner) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut inner = self
            .0
            .lock()
            .map_err(|_| "catalog lock poisoned".to_string())?;
        if inner.connection.is_none() {
            initialize(&mut inner, app)?;
        }
        operation(&mut inner)
    }

    fn open_collection(
        &self,
        app: &AppHandle,
        path: String,
        recursive: bool,
        requested_page_size: u32,
    ) -> Result<LibraryCollectionOpened, String> {
        self.with_inner(app, |inner| {
            let available = Path::new(&path).is_dir();
            let path = Path::new(&path)
                .canonicalize()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or(path);
            let page_size = requested_page_size.clamp(1, MAX_PAGE_SIZE);
            let warm_started = Instant::now();
            let indexed = inner
                .connection
                .as_ref()
                .expect("initialized catalog")
                .query_row(
                    "SELECT indexed FROM roots WHERE ?1=root_path OR ?1 LIKE root_path || ?2 || '%' ORDER BY LENGTH(root_path) DESC LIMIT 1",
                    params![path, std::path::MAIN_SEPARATOR.to_string()],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?
                == Some(1);
            let indexing_state = if indexed && !available {
                CatalogIndexingState::Offline
            } else if indexed {
                inner.report.warm_query_latency_ms = warm_started.elapsed().as_millis() as u64;
                CatalogIndexingState::Current
            } else {
                reconcile_root(inner, app, Path::new(&path))?;
                CatalogIndexingState::Rebuilt
            };
            let revision = catalog_revision(inner)?;
            let estimated_count = query_count(inner, &path, recursive)?;
            let first_started = Instant::now();
            let first_page = query_page(inner, &path, recursive, 0, page_size)?;
            inner.report.first_page_latency_ms = first_started.elapsed().as_millis() as u64;
            let session_id = inner.next_session_id;
            inner.next_session_id = inner.next_session_id.saturating_add(1);
            inner.sessions.insert(
                session_id,
                CollectionSession {
                    root: path,
                    recursive,
                    revision,
                    next_offset: first_page.len() as u64,
                    page_size,
                    started: Instant::now(),
                },
            );
            Ok(LibraryCollectionOpened {
                session_id,
                catalog_revision: revision,
                estimated_count,
                first_page,
                indexing_state,
            })
        })
    }
}

fn initialize(inner: &mut CatalogInner, app: &AppHandle) -> Result<(), String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("library-catalog-v1.sqlite3");
    let mut connection = match Connection::open(&path) {
        Ok(connection) => connection,
        Err(_) => {
            quarantine_catalog(&path)?;
            inner.report.corrupt_recovery_count =
                inner.report.corrupt_recovery_count.saturating_add(1);
            Connection::open(&path).map_err(|error| error.to_string())?
        }
    };
    let integrity = connection
        .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .unwrap_or_else(|_| "corrupt".into());
    if integrity != "ok" {
        drop(connection);
        quarantine_catalog(&path)?;
        inner.report.corrupt_recovery_count = inner.report.corrupt_recovery_count.saturating_add(1);
        connection = Connection::open(&path).map_err(|error| error.to_string())?;
    }
    let version = connection
        .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
        .unwrap_or(0);
    if version != 0 && version != CATALOG_SCHEMA_VERSION {
        connection
            .execute_batch("DROP TABLE IF EXISTS folders; DROP TABLE IF EXISTS entities; DROP TABLE IF EXISTS sources; DROP TABLE IF EXISTS roots; DROP TABLE IF EXISTS catalog_meta;")
            .map_err(|error| error.to_string())?;
        inner.report.migration_rebuild_count =
            inner.report.migration_rebuild_count.saturating_add(1);
    }
    connection
        .execute_batch(schema_sql())
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "user_version", CATALOG_SCHEMA_VERSION)
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR REPLACE INTO catalog_meta(key,value) VALUES ('authority','filesystem+rrdata+rrexif+xmp'),('exif_projection_version',?1),('edit_status_version',?2)",
            params![EXIF_PROJECTION_VERSION.to_string(), EDIT_STATUS_VERSION.to_string()],
        )
        .map_err(|error| error.to_string())?;
    inner.report.catalog_id = root_id(&path);
    inner.db_path = Some(path);
    inner.connection = Some(connection);
    refresh_counts(inner)?;
    Ok(())
}

fn quarantine_catalog(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    fs::rename(path, path.with_extension(format!("corrupt-{suffix}")))
        .map_err(|error| error.to_string())
}

fn reconcile_root(inner: &mut CatalogInner, app: &AppHandle, root: &Path) -> Result<(), String> {
    let canonical = root.canonicalize().map_err(|error| error.to_string())?;
    let root_string = canonical.to_string_lossy().into_owned();
    let connection = inner.connection.as_mut().expect("initialized catalog");
    let generation = connection
        .query_row(
            "SELECT generation FROM roots WHERE root_path=?1",
            params![root_string],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(0_i64)
        .saturating_add(1);

    let mut sources = Vec::<PathBuf>::new();
    let mut sidecars = HashMap::<PathBuf, Vec<Option<String>>>::new();
    let mut auxiliary = HashMap::<PathBuf, Vec<PathBuf>>::new();
    for entry in WalkDir::new(&canonical)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if let Some((source_name, copy_id)) = split_rrdata_sidecar_filename(name) {
            let source = path.parent().unwrap_or(&canonical).join(source_name);
            sidecars.entry(source.clone()).or_default().push(copy_id);
            auxiliary
                .entry(source)
                .or_default()
                .push(path.to_path_buf());
        } else if is_supported_image_file(name) {
            sources.push(path.to_path_buf());
        } else if name.to_ascii_lowercase().ends_with(".rrexif")
            || name.to_ascii_lowercase().ends_with(".xmp")
        {
            let source_name = &name[..name.rfind('.').unwrap_or(name.len())];
            auxiliary
                .entry(path.parent().unwrap_or(&canonical).join(source_name))
                .or_default()
                .push(path.to_path_buf());
        }
    }
    sources.sort_unstable();
    let settings = load_settings_or_default(app);
    let xmp = settings.enable_xmp_sync.unwrap_or(false);
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let mut parsed = 0_u64;
    let mut reused = 0_u64;
    let mut sidecar_reads = 0_u64;
    let mut exif_reads = 0_u64;
    for source in &sources {
        let source_key = source_revision_key(source)?;
        let mut sidecar_paths = auxiliary.remove(source).unwrap_or_default();
        let mut copies = sidecars.remove(source).unwrap_or_default();
        if !copies.contains(&None) {
            copies.push(None);
        }
        for copy in &copies {
            let path = crate::library::delete_plan::rrdata_sidecar_path(source, copy.as_deref());
            if path.exists() && !sidecar_paths.contains(&path) {
                sidecar_paths.push(path);
            }
        }
        sidecar_paths.sort_unstable();
        let sidecar_key = sidecar_paths
            .iter()
            .map(|path| revision_for_path(path))
            .collect::<Vec<_>>()
            .join("|");
        let source_string = source.to_string_lossy().into_owned();
        let current = transaction
            .query_row(
                "SELECT source_revision,sidecar_revision FROM sources WHERE source_path=?1",
                params![source_string],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if current
            .as_ref()
            .is_some_and(|(source_revision, sidecar_revision)| {
                source_revision == &source_key && sidecar_revision == &sidecar_key
            })
        {
            transaction
                .execute(
                    "UPDATE sources SET seen_generation=?2 WHERE source_path=?1",
                    params![source_string, generation],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "UPDATE entities SET seen_generation=?2 WHERE source_path=?1",
                    params![source_string, generation],
                )
                .map_err(|error| error.to_string())?;
            reused = reused.saturating_add(1);
            continue;
        }
        sidecar_reads = sidecar_reads.saturating_add(sidecar_paths.len() as u64);
        let mut rows = expand_image_file_rows(source.clone(), copies, &settings, xmp);
        let exif = read_exif_for_paths_blocking(vec![source_string.clone()]);
        exif_reads = exif_reads.saturating_add(1);
        for row in &mut rows {
            row.exif = exif.get(&source_string).cloned();
        }
        let folder = source
            .parent()
            .unwrap_or(&canonical)
            .to_string_lossy()
            .into_owned();
        let previous_revisions = {
            let mut statement = transaction
                .prepare("SELECT image_id,entity_revision FROM entities WHERE source_path=?1")
                .map_err(|error| error.to_string())?;
            statement
                .query_map(params![source_string], |record| {
                    Ok((record.get::<_, String>(0)?, record.get::<_, i64>(1)?))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<HashMap<_, _>, _>>()
                .map_err(|error| error.to_string())?
        };
        transaction
            .execute(
                "DELETE FROM entities WHERE source_path=?1",
                params![source_string],
            )
            .map_err(|error| error.to_string())?;
        for row in rows {
            let entity_revision = previous_revisions
                .get(&row.path)
                .copied()
                .unwrap_or(0)
                .saturating_add(1);
            let json = serde_json::to_string(&row).map_err(|error| error.to_string())?;
            transaction.execute(
                "INSERT OR REPLACE INTO entities(image_id,source_path,root_path,folder_path,entity_json,entity_revision,seen_generation) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![row.path, source_string, root_string, folder, json, entity_revision, generation],
            ).map_err(|error| error.to_string())?;
        }
        transaction.execute(
            "INSERT OR REPLACE INTO sources(source_path,root_path,folder_path,source_revision,sidecar_revision,seen_generation) VALUES (?1,?2,?3,?4,?5,?6)",
            params![source_string, root_string, folder, source_key, sidecar_key, generation],
        ).map_err(|error| error.to_string())?;
        parsed = parsed.saturating_add(1);
    }
    transaction
        .execute(
            "DELETE FROM entities WHERE root_path=?1 AND seen_generation<>?2",
            params![root_string, generation],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM sources WHERE root_path=?1 AND seen_generation<>?2",
            params![root_string, generation],
        )
        .map_err(|error| error.to_string())?;
    let revision = transaction.query_row("SELECT COALESCE(MAX(CAST(value AS INTEGER)),0)+1 FROM catalog_meta WHERE key='catalog_revision'", [], |row| row.get::<_, i64>(0)).unwrap_or(1);
    transaction
        .execute(
            "INSERT OR REPLACE INTO catalog_meta(key,value) VALUES ('catalog_revision',?1)",
            params![revision.to_string()],
        )
        .map_err(|error| error.to_string())?;
    transaction.execute("INSERT OR REPLACE INTO roots(root_path,root_id,generation,indexed,catalog_revision) VALUES (?1,?2,?3,1,?4)", params![root_string, root_id(&canonical), generation, revision]).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    rebuild_folder_aggregates(inner, &root_string, revision)?;
    inner.report.rows_parsed = inner.report.rows_parsed.saturating_add(parsed);
    inner.report.rows_reused = inner.report.rows_reused.saturating_add(reused);
    inner.report.sidecar_reads = inner.report.sidecar_reads.saturating_add(sidecar_reads);
    inner.report.exif_reads = inner.report.exif_reads.saturating_add(exif_reads);
    inner.report.transaction_count = inner.report.transaction_count.saturating_add(2);
    inner.report.last_batch_size = sources.len() as u64;
    refresh_counts(inner)?;
    Ok(())
}

fn targeted_paths(changes: Vec<LibraryPathChange>) -> (HashSet<PathBuf>, HashSet<PathBuf>) {
    let mut removals = HashSet::new();
    let mut updates = HashSet::new();
    for change in changes {
        match change {
            LibraryPathChange::Added { path } | LibraryPathChange::Modified { path, .. } => {
                updates.insert(PathBuf::from(path));
            }
            LibraryPathChange::Removed { path } => {
                removals.insert(PathBuf::from(path));
            }
            LibraryPathChange::Renamed { old_path, new_path } => {
                removals.insert(PathBuf::from(old_path));
                updates.insert(PathBuf::from(new_path));
            }
        }
    }
    (removals, updates)
}

fn source_sidecars(source: &Path) -> (Vec<Option<String>>, Vec<PathBuf>) {
    let mut copies = vec![None];
    let mut sidecars = Vec::new();
    let Some(parent) = source.parent() else {
        return (copies, sidecars);
    };
    let source_name = source.file_name().and_then(|name| name.to_str());
    let Ok(entries) = fs::read_dir(parent) else {
        return (copies, sidecars);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if let Some((candidate, copy_id)) = split_rrdata_sidecar_filename(name) {
            if Some(candidate.as_str()) == source_name {
                if !copies.contains(&copy_id) {
                    copies.push(copy_id);
                }
                sidecars.push(path);
            }
        } else if source_name.is_some_and(|source_name| {
            name == format!("{source_name}.rrexif") || name == format!("{source_name}.xmp")
        }) {
            sidecars.push(path);
        }
    }
    copies.sort();
    sidecars.sort_unstable();
    (copies, sidecars)
}

fn apply_change_batch(
    inner: &mut CatalogInner,
    app: &AppHandle,
    root: &Path,
    changes: Vec<LibraryPathChange>,
) -> Result<CatalogChangeApplied, String> {
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let root_string = canonical_root.to_string_lossy().into_owned();
    let (removals, updates) = targeted_paths(changes);
    let updates = updates
        .into_iter()
        .flat_map(|path| {
            if path.is_dir() {
                WalkDir::new(path)
                    .follow_links(false)
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|entry| entry.file_type().is_file())
                    .map(|entry| entry.into_path())
                    .filter(|path| {
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .is_some_and(is_supported_image_file)
                    })
                    .collect::<Vec<_>>()
            } else {
                vec![path]
            }
        })
        .collect::<HashSet<_>>();
    let settings = load_settings_or_default(app);
    let xmp = settings.enable_xmp_sync.unwrap_or(false);
    let connection = inner.connection.as_mut().expect("initialized catalog");
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let mut removed_image_ids = Vec::new();
    let mut upserted = Vec::new();
    for path in removals {
        let value = path.to_string_lossy().into_owned();
        let prefix = format!("{value}{}%", std::path::MAIN_SEPARATOR);
        let mut statement = transaction
            .prepare("SELECT image_id FROM entities WHERE source_path=?1 OR source_path LIKE ?2")
            .map_err(|error| error.to_string())?;
        removed_image_ids.extend(
            statement
                .query_map(params![value, prefix], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?,
        );
        drop(statement);
        transaction
            .execute(
                "DELETE FROM entities WHERE source_path=?1 OR source_path LIKE ?2",
                params![value, prefix],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM sources WHERE source_path=?1 OR source_path LIKE ?2",
                params![value, prefix],
            )
            .map_err(|error| error.to_string())?;
    }
    let mut parsed = 0_u64;
    let mut sidecar_reads = 0_u64;
    for source in updates {
        let supported = source.is_file()
            && source
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_supported_image_file);
        if !supported {
            continue;
        }
        let source_string = source.to_string_lossy().into_owned();
        let source_key = source_revision_key(&source)?;
        let (copies, sidecars) = source_sidecars(&source);
        let sidecar_key = sidecars
            .iter()
            .map(|path| revision_for_path(path))
            .collect::<Vec<_>>()
            .join("|");
        let current = transaction
            .query_row(
                "SELECT source_revision,sidecar_revision FROM sources WHERE source_path=?1",
                params![source_string],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if current
            .as_ref()
            .is_some_and(|(source_revision, sidecar_revision)| {
                source_revision == &source_key && sidecar_revision == &sidecar_key
            })
        {
            continue;
        }
        let previous = {
            let mut statement = transaction
                .prepare("SELECT image_id,entity_revision FROM entities WHERE source_path=?1")
                .map_err(|error| error.to_string())?;
            statement
                .query_map(params![source_string], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<HashMap<_, _>, _>>()
                .map_err(|error| error.to_string())?
        };
        let mut rows = expand_image_file_rows(source.clone(), copies, &settings, xmp);
        let exif = read_exif_for_paths_blocking(vec![source_string.clone()]);
        rows.iter_mut()
            .for_each(|row| row.exif = exif.get(&source_string).cloned());
        let next_ids = rows
            .iter()
            .map(|row| row.path.as_str())
            .collect::<HashSet<_>>();
        removed_image_ids.extend(
            previous
                .keys()
                .filter(|image_id| !next_ids.contains(image_id.as_str()))
                .cloned(),
        );
        transaction
            .execute(
                "DELETE FROM entities WHERE source_path=?1",
                params![source_string],
            )
            .map_err(|error| error.to_string())?;
        let folder = source
            .parent()
            .unwrap_or(&canonical_root)
            .to_string_lossy()
            .into_owned();
        for row in rows {
            let revision = previous
                .get(&row.path)
                .copied()
                .unwrap_or(0)
                .saturating_add(1);
            let json = serde_json::to_string(&row).map_err(|error| error.to_string())?;
            transaction.execute(
                "INSERT INTO entities(image_id,source_path,root_path,folder_path,entity_json,entity_revision,seen_generation) VALUES (?1,?2,?3,?4,?5,?6,0)",
                params![row.path, source_string, root_string, folder, json, revision],
            ).map_err(|error| error.to_string())?;
            upserted.push(CatalogImageProjection {
                image_id: row.path.clone(),
                entity_revision: revision as u64,
                image: row,
            });
        }
        transaction.execute(
            "INSERT OR REPLACE INTO sources(source_path,root_path,folder_path,source_revision,sidecar_revision,seen_generation) VALUES (?1,?2,?3,?4,?5,0)",
            params![source_string, root_string, folder, source_key, sidecar_key],
        ).map_err(|error| error.to_string())?;
        parsed = parsed.saturating_add(1);
        sidecar_reads = sidecar_reads.saturating_add(sidecars.len() as u64);
    }
    let revision = transaction.query_row("SELECT COALESCE(MAX(CAST(value AS INTEGER)),0)+1 FROM catalog_meta WHERE key='catalog_revision'", [], |row| row.get::<_, i64>(0)).unwrap_or(1);
    transaction
        .execute(
            "INSERT OR REPLACE INTO catalog_meta(key,value) VALUES ('catalog_revision',?1)",
            params![revision.to_string()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    rebuild_folder_aggregates(inner, &root_string, revision)?;
    inner.report.rows_parsed = inner.report.rows_parsed.saturating_add(parsed);
    inner.report.sidecar_reads = inner.report.sidecar_reads.saturating_add(sidecar_reads);
    inner.report.exif_reads = inner.report.exif_reads.saturating_add(parsed);
    inner.report.transaction_count = inner.report.transaction_count.saturating_add(2);
    inner.report.last_batch_size = parsed;
    refresh_counts(inner)?;
    Ok(CatalogChangeApplied {
        catalog_revision: revision as u64,
        upserted,
        removed_image_ids,
    })
}

fn rebuild_folder_aggregates(
    inner: &mut CatalogInner,
    root: &str,
    revision: i64,
) -> Result<(), String> {
    let connection = inner.connection.as_mut().expect("initialized catalog");
    let mut statement = connection
        .prepare(
            "SELECT folder_path,COUNT(*) FROM entities WHERE root_path=?1 GROUP BY folder_path",
        )
        .map_err(|error| error.to_string())?;
    let direct: BTreeMap<String, i64> = statement
        .query_map(params![root], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|error| error.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement);
    let mut folders: HashSet<String> = direct.keys().cloned().collect();
    folders.insert(root.to_string());
    for folder in direct.keys() {
        let mut current = Path::new(folder).parent();
        while let Some(parent) = current {
            let parent_string = parent.to_string_lossy().into_owned();
            if !parent_string.starts_with(root) {
                break;
            }
            folders.insert(parent_string.clone());
            if parent_string == root {
                break;
            }
            current = parent.parent();
        }
    }
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM folders WHERE root_path=?1", params![root])
        .map_err(|error| error.to_string())?;
    for folder in &folders {
        let prefix = format!("{folder}{}", std::path::MAIN_SEPARATOR);
        let recursive = direct
            .iter()
            .filter(|(path, _)| *path == folder || path.starts_with(&prefix))
            .map(|(_, count)| *count)
            .sum::<i64>();
        let child_count = folders
            .iter()
            .filter(|candidate| {
                Path::new(candidate)
                    .parent()
                    .is_some_and(|parent| parent == Path::new(folder))
            })
            .count() as i64;
        transaction.execute(
            "INSERT INTO folders(folder_path,root_path,direct_image_count,recursive_image_count,child_folder_count,catalog_revision) VALUES (?1,?2,?3,?4,?5,?6)",
            params![folder, root, direct.get(folder).copied().unwrap_or(0), recursive, child_count, revision],
        ).map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn query_count(inner: &mut CatalogInner, root: &str, recursive: bool) -> Result<u64, String> {
    let connection = inner.connection.as_ref().expect("initialized catalog");
    if recursive {
        let prefix = format!("{root}{}%", std::path::MAIN_SEPARATOR);
        connection
            .query_row(
                "SELECT COUNT(*) FROM entities WHERE folder_path=?1 OR folder_path LIKE ?2",
                params![root, prefix],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value as u64)
            .map_err(|error| error.to_string())
    } else {
        connection
            .query_row(
                "SELECT COUNT(*) FROM entities WHERE folder_path=?1",
                params![root],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value as u64)
            .map_err(|error| error.to_string())
    }
}

fn query_page(
    inner: &mut CatalogInner,
    root: &str,
    recursive: bool,
    offset: u64,
    limit: u32,
) -> Result<Vec<CatalogImageProjection>, String> {
    let connection = inner.connection.as_ref().expect("initialized catalog");
    let (sql, prefix) = if recursive {
        (
            "SELECT image_id,entity_json,entity_revision FROM entities WHERE folder_path=?1 OR folder_path LIKE ?2 ORDER BY image_id LIMIT ?3 OFFSET ?4",
            format!("{root}{}%", std::path::MAIN_SEPARATOR),
        )
    } else {
        (
            "SELECT image_id,entity_json,entity_revision FROM entities WHERE folder_path=?1 AND (?2=?2) ORDER BY image_id LIMIT ?3 OFFSET ?4",
            String::new(),
        )
    };
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    statement
        .query_map(
            params![root, prefix, i64::from(limit), offset as i64],
            |row| {
                let image_id: String = row.get(0)?;
                let json: String = row.get(1)?;
                let image = serde_json::from_str(&json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        json.len(),
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                Ok(CatalogImageProjection {
                    image_id,
                    image,
                    entity_revision: row.get::<_, i64>(2)? as u64,
                })
            },
        )
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn catalog_revision(inner: &mut CatalogInner) -> Result<u64, String> {
    inner.connection.as_ref().expect("initialized catalog").query_row("SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM catalog_meta WHERE key='catalog_revision'),0)", [], |row| row.get::<_, i64>(0)).map(|value| value as u64).map_err(|error| error.to_string())
}

fn refresh_counts(inner: &mut CatalogInner) -> Result<(), String> {
    let revision = catalog_revision(inner)?;
    let connection = inner.connection.as_ref().expect("initialized catalog");
    inner.report.catalog_revision = revision;
    inner.report.source_count = connection
        .query_row("SELECT COUNT(*) FROM sources", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| error.to_string())? as u64;
    inner.report.entity_count = connection
        .query_row("SELECT COUNT(*) FROM entities", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| error.to_string())? as u64;
    inner.report.folder_count = connection
        .query_row("SELECT COUNT(*) FROM folders", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| error.to_string())? as u64;
    Ok(())
}

#[tauri::command]
pub fn open_library_collection(
    app: AppHandle,
    state: State<'_, LibraryCatalog>,
    path: String,
    recursive: bool,
    requested_page_size: Option<u32>,
) -> Result<LibraryCollectionOpened, String> {
    state.open_collection(
        &app,
        path,
        recursive,
        requested_page_size.unwrap_or(DEFAULT_PAGE_SIZE),
    )
}

#[tauri::command]
pub fn next_library_collection_page(
    app: AppHandle,
    state: State<'_, LibraryCatalog>,
    session_id: u64,
) -> Result<LibraryCollectionPage, String> {
    state.with_inner(&app, |inner| {
        let session = inner
            .sessions
            .get(&session_id)
            .cloned()
            .ok_or_else(|| "library collection session expired".to_string())?;
        let current_revision = catalog_revision(inner)?;
        if current_revision != session.revision {
            inner.sessions.remove(&session_id);
            return Err("library collection session replaced".into());
        }
        let rows = query_page(
            inner,
            &session.root,
            session.recursive,
            session.next_offset,
            session.page_size,
        )?;
        let complete = rows.len() < session.page_size as usize;
        if complete {
            inner.report.full_collection_latency_ms = session.started.elapsed().as_millis() as u64;
            inner.sessions.remove(&session_id);
        } else if let Some(stored) = inner.sessions.get_mut(&session_id) {
            stored.next_offset = stored.next_offset.saturating_add(rows.len() as u64);
        }
        Ok(LibraryCollectionPage {
            session_id,
            catalog_revision: current_revision,
            rows,
            complete,
        })
    })
}

#[tauri::command]
pub fn reconcile_library_catalog(
    app: AppHandle,
    state: State<'_, LibraryCatalog>,
    path: String,
) -> Result<LibraryCatalogReport, String> {
    state.with_inner(&app, |inner| {
        reconcile_root(inner, &app, Path::new(&path))?;
        Ok(inner.report.clone())
    })
}

#[tauri::command]
pub fn apply_library_catalog_changes(
    app: AppHandle,
    state: State<'_, LibraryCatalog>,
    root: String,
    changes: Vec<LibraryPathChange>,
) -> Result<CatalogChangeApplied, String> {
    state.with_inner(&app, |inner| {
        apply_change_batch(inner, &app, Path::new(&root), changes)
    })
}

#[tauri::command]
pub fn get_library_catalog_report(
    app: AppHandle,
    state: State<'_, LibraryCatalog>,
) -> Result<LibraryCatalogReport, String> {
    state.with_inner(&app, |inner| {
        refresh_counts(inner)?;
        Ok(inner.report.clone())
    })
}

#[tauri::command]
pub fn get_library_folder_aggregates(
    app: AppHandle,
    state: State<'_, LibraryCatalog>,
    paths: Vec<String>,
) -> Result<Vec<CatalogFolderAggregate>, String> {
    state.with_inner(&app, |inner| {
        let connection = inner.connection.as_ref().expect("initialized catalog");
        let mut aggregates = Vec::new();
        for path in paths {
            let row = connection
                .query_row(
                    "SELECT direct_image_count,recursive_image_count,child_folder_count,catalog_revision FROM folders WHERE folder_path=?1",
                    params![path],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?, row.get::<_, i64>(3)?)),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if let Some((direct, recursive, children, revision)) = row {
                aggregates.push(CatalogFolderAggregate {
                    path,
                    direct_image_count: direct as u64,
                    recursive_image_count: recursive as u64,
                    child_folder_count: children as u64,
                    catalog_revision: revision as u64,
                });
            }
        }
        Ok(aggregates)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(path: String) -> ImageFile {
        ImageFile {
            path,
            modified: 1,
            is_edited: false,
            rating: 0,
            tags: None,
            exif: None,
            is_virtual_copy: false,
        }
    }

    #[test]
    fn source_revision_detects_same_second_replacement() {
        let root = tempfile::tempdir().expect("temp root");
        let path = root.path().join("image.jpg");
        fs::write(&path, b"one").expect("write source");
        let first = source_revision_key(&path).expect("first revision");
        fs::write(&path, b"replacement-with-different-size").expect("replace source");
        let second = source_revision_key(&path).expect("second revision");
        assert_ne!(first, second);
    }

    #[test]
    fn schema_supports_revisioned_entities_and_folder_aggregates() {
        let connection = Connection::open_in_memory().expect("memory catalog");
        connection.execute_batch(schema_sql()).expect("schema");
        let tables: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('roots','sources','entities','folders')", [], |row| row.get(0)).expect("table count");
        assert_eq!(tables, 4);
    }

    #[test]
    fn fifty_thousand_row_catalog_query_materializes_only_requested_page() {
        let connection = Connection::open_in_memory().expect("memory catalog");
        connection.execute_batch(schema_sql()).expect("schema");
        let transaction = connection.unchecked_transaction().expect("transaction");
        for index in 0..50_000 {
            let path = format!("/library/image-{index:05}.jpg");
            let json = serde_json::to_string(&image(path.clone())).expect("projection");
            transaction
                .execute(
                    "INSERT INTO entities(image_id,source_path,root_path,folder_path,entity_json,entity_revision,seen_generation) VALUES (?1,?1,'/library','/library',?2,1,1)",
                    params![path, json],
                )
                .expect("insert projection");
        }
        transaction.commit().expect("commit");
        let mut inner = CatalogInner {
            connection: Some(connection),
            ..CatalogInner::default()
        };
        assert_eq!(
            query_count(&mut inner, "/library", false).expect("count"),
            50_000
        );
        let first = query_page(&mut inner, "/library", false, 0, 256).expect("first page");
        let second = query_page(&mut inner, "/library", false, 256, 256).expect("second page");
        assert_eq!(first.len(), 256);
        assert_eq!(second.len(), 256);
        assert_ne!(first[0].image_id, second[0].image_id);
        assert_eq!(inner.report.sidecar_reads, 0);
        assert_eq!(inner.report.exif_reads, 0);
    }

    #[test]
    fn corrupt_catalog_is_quarantined_without_touching_sources() {
        let root = tempfile::tempdir().expect("temp root");
        let catalog = root.path().join("library-catalog-v1.sqlite3");
        fs::write(&catalog, b"not a sqlite database").expect("corrupt catalog");
        quarantine_catalog(&catalog).expect("quarantine");
        assert!(!catalog.exists());
        assert!(
            fs::read_dir(root.path())
                .expect("read root")
                .flatten()
                .any(|entry| entry.file_name().to_string_lossy().contains("corrupt-"))
        );
    }

    #[test]
    fn change_batch_bounds_work_to_changed_source_identities() {
        let changes = vec![
            LibraryPathChange::Modified {
                path: "/library/a.raw".into(),
                class: super::super::changefeed::LibraryChangeClass::Sidecar,
            },
            LibraryPathChange::Renamed {
                old_path: "/library/b.raw".into(),
                new_path: "/library/c.raw".into(),
            },
            LibraryPathChange::Removed {
                path: "/library/d.raw".into(),
            },
        ];
        let (removals, updates) = targeted_paths(changes);
        assert_eq!(
            updates,
            HashSet::from([
                PathBuf::from("/library/a.raw"),
                PathBuf::from("/library/c.raw")
            ])
        );
        assert_eq!(
            removals,
            HashSet::from([
                PathBuf::from("/library/b.raw"),
                PathBuf::from("/library/d.raw")
            ])
        );
    }
}
