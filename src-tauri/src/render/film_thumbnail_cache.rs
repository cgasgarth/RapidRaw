//! Verified bounded memory and disk caches for renderer-backed Film thumbnails.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const DISK_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FilmThumbnailDescriptor {
    pub key: String,
    pub payload_sha256: String,
    pub width: u32,
    pub height: u32,
    pub renderer_version: String,
    pub output_identity: String,
}

#[derive(Clone)]
pub(crate) struct FilmThumbnailEntry {
    pub descriptor: FilmThumbnailDescriptor,
    pub payload: Arc<Vec<u8>>,
    pub pinned: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct FilmThumbnailLookup {
    pub key: String,
    pub width: u32,
    pub height: u32,
    pub renderer_version: String,
    pub output_identity: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FilmThumbnailCacheRejection {
    CorruptPayload,
    HeaderMismatch,
    RendererVersionMismatch,
    EntryExceedsBudget,
    PinnedBudgetExhausted,
}

pub(crate) enum FilmThumbnailCacheLookupResult {
    Hit(FilmThumbnailEntry),
    Miss,
    Rejected(FilmThumbnailCacheRejection),
}

pub(crate) struct FilmThumbnailCache {
    max_entries: usize,
    max_bytes: usize,
    resident_bytes: usize,
    order: VecDeque<String>,
    entries: HashMap<String, FilmThumbnailEntry>,
}

impl FilmThumbnailCache {
    pub(crate) fn new(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            max_entries,
            max_bytes,
            resident_bytes: 0,
            order: VecDeque::new(),
            entries: HashMap::new(),
        }
    }

    pub(crate) fn get(&mut self, expected: &FilmThumbnailLookup) -> FilmThumbnailCacheLookupResult {
        let Some(entry) = self.entries.get(&expected.key).cloned() else {
            return FilmThumbnailCacheLookupResult::Miss;
        };
        let rejection = validate_entry(&entry, expected).err();
        if let Some(rejection) = rejection {
            self.remove(&expected.key);
            return FilmThumbnailCacheLookupResult::Rejected(rejection);
        }
        self.touch(&expected.key);
        FilmThumbnailCacheLookupResult::Hit(entry)
    }

    pub(crate) fn insert(
        &mut self,
        entry: FilmThumbnailEntry,
    ) -> Result<(), FilmThumbnailCacheRejection> {
        let inserted_key = entry.descriptor.key.clone();
        let weight = entry.payload.len();
        if weight == 0 || weight > self.max_bytes || self.max_entries == 0 {
            return Err(FilmThumbnailCacheRejection::EntryExceedsBudget);
        }
        if sha256_prefixed(entry.payload.as_slice()) != entry.descriptor.payload_sha256 {
            return Err(FilmThumbnailCacheRejection::CorruptPayload);
        }
        self.remove(&entry.descriptor.key);
        self.resident_bytes += weight;
        self.order.push_back(entry.descriptor.key.clone());
        self.entries.insert(entry.descriptor.key.clone(), entry);

        while self.entries.len() > self.max_entries || self.resident_bytes > self.max_bytes {
            let Some(candidate) = self
                .order
                .iter()
                .find(|key| self.entries.get(*key).is_some_and(|entry| !entry.pinned))
                .cloned()
            else {
                let inserted = self.order.back().cloned();
                if let Some(inserted) = inserted {
                    self.remove(&inserted);
                }
                return Err(FilmThumbnailCacheRejection::PinnedBudgetExhausted);
            };
            self.remove(&candidate);
        }
        if !self.entries.contains_key(&inserted_key) {
            return Err(FilmThumbnailCacheRejection::PinnedBudgetExhausted);
        }
        Ok(())
    }

    pub(crate) fn set_pinned(&mut self, key: &str, pinned: bool) -> bool {
        let Some(entry) = self.entries.get_mut(key) else {
            return false;
        };
        entry.pinned = pinned;
        true
    }

    pub(crate) fn clear_unpinned(&mut self) {
        let keys = self
            .entries
            .iter()
            .filter_map(|(key, entry)| (!entry.pinned).then_some(key.clone()))
            .collect::<Vec<_>>();
        for key in keys {
            self.remove(&key);
        }
    }

    #[cfg(test)]
    pub(crate) fn resident_bytes(&self) -> usize {
        self.resident_bytes
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    fn touch(&mut self, key: &str) {
        self.order.retain(|candidate| candidate != key);
        self.order.push_back(key.to_string());
    }

    fn remove(&mut self, key: &str) {
        if let Some(entry) = self.entries.remove(key) {
            self.resident_bytes = self.resident_bytes.saturating_sub(entry.payload.len());
        }
        self.order.retain(|candidate| candidate != key);
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiskEnvelopeV1 {
    schema_version: u8,
    descriptor: FilmThumbnailDescriptor,
    payload_base64: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiskIndexV1 {
    schema_version: u8,
    order: Vec<String>,
}

pub(crate) struct FilmThumbnailDiskCache {
    root: PathBuf,
    max_entries: usize,
    max_bytes: u64,
    order: VecDeque<String>,
}

impl FilmThumbnailDiskCache {
    pub(crate) fn open(root: PathBuf, max_entries: usize, max_bytes: u64) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        let order = read_index(&root).unwrap_or_default();
        let mut cache = Self {
            root,
            max_entries,
            max_bytes,
            order,
        };
        cache.retain_existing();
        cache.remove_orphans()?;
        cache.enforce_budget()?;
        Ok(cache)
    }

    pub(crate) fn get(
        &mut self,
        expected: &FilmThumbnailLookup,
    ) -> Result<FilmThumbnailCacheLookupResult, String> {
        let path = self.entry_path(&expected.key);
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(FilmThumbnailCacheLookupResult::Miss);
            }
            Err(error) => return Err(error.to_string()),
        };
        let envelope = match serde_json::from_slice::<DiskEnvelopeV1>(&bytes) {
            Ok(envelope) if envelope.schema_version == DISK_SCHEMA_VERSION => envelope,
            _ => {
                self.reject_disk_entry(&expected.key, &path)?;
                return Ok(FilmThumbnailCacheLookupResult::Rejected(
                    FilmThumbnailCacheRejection::HeaderMismatch,
                ));
            }
        };
        let payload = match general_purpose::STANDARD.decode(&envelope.payload_base64) {
            Ok(payload) => payload,
            Err(_) => {
                self.reject_disk_entry(&expected.key, &path)?;
                return Ok(FilmThumbnailCacheLookupResult::Rejected(
                    FilmThumbnailCacheRejection::CorruptPayload,
                ));
            }
        };
        let entry = FilmThumbnailEntry {
            descriptor: envelope.descriptor,
            payload: Arc::new(payload),
            pinned: false,
        };
        if let Err(rejection) = validate_entry(&entry, expected) {
            self.reject_disk_entry(&expected.key, &path)?;
            return Ok(FilmThumbnailCacheLookupResult::Rejected(rejection));
        }
        self.touch(&expected.key);
        self.persist_index()?;
        Ok(FilmThumbnailCacheLookupResult::Hit(entry))
    }

    pub(crate) fn insert(&mut self, entry: &FilmThumbnailEntry) -> Result<(), String> {
        if entry.payload.is_empty() || entry.payload.len() as u64 > self.max_bytes {
            return Err("film_thumbnail_disk_entry_exceeds_budget".to_string());
        }
        if sha256_prefixed(entry.payload.as_slice()) != entry.descriptor.payload_sha256 {
            return Err("film_thumbnail_disk_payload_hash_mismatch".to_string());
        }
        let envelope = DiskEnvelopeV1 {
            schema_version: DISK_SCHEMA_VERSION,
            descriptor: entry.descriptor.clone(),
            payload_base64: general_purpose::STANDARD.encode(entry.payload.as_slice()),
        };
        let json = serde_json::to_string(&envelope).map_err(|error| error.to_string())?;
        crate::exif_processing::write_text_file_atomic(
            &self.entry_path(&entry.descriptor.key),
            &json,
        )?;
        self.touch(&entry.descriptor.key);
        self.enforce_budget()?;
        self.persist_index()
    }

    fn enforce_budget(&mut self) -> Result<(), String> {
        loop {
            let bytes = self
                .order
                .iter()
                .filter_map(|key| {
                    fs::metadata(self.entry_path(key))
                        .ok()
                        .map(|meta| meta.len())
                })
                .sum::<u64>();
            if self.order.len() <= self.max_entries && bytes <= self.max_bytes {
                break;
            }
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            remove_if_exists(&self.entry_path(&oldest))?;
        }
        self.persist_index()
    }

    fn retain_existing(&mut self) {
        let root = self.root.clone();
        self.order
            .retain(|key| entry_path_for(&root, key).is_file());
    }

    fn remove_orphans(&self) -> Result<(), String> {
        let retained = self
            .order
            .iter()
            .map(|key| self.entry_path(key))
            .collect::<std::collections::HashSet<_>>();
        for entry in fs::read_dir(&self.root).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path
                .extension()
                .is_some_and(|extension| extension == "json")
                && path.file_name().is_none_or(|name| name != "index-v1.json")
                && !retained.contains(&path)
            {
                remove_if_exists(&path)?;
            }
        }
        Ok(())
    }

    fn reject_disk_entry(&mut self, key: &str, path: &Path) -> Result<(), String> {
        remove_if_exists(path)?;
        self.order.retain(|candidate| candidate != key);
        self.persist_index()
    }

    fn touch(&mut self, key: &str) {
        self.order.retain(|candidate| candidate != key);
        self.order.push_back(key.to_string());
    }

    fn persist_index(&self) -> Result<(), String> {
        let index = DiskIndexV1 {
            schema_version: DISK_SCHEMA_VERSION,
            order: self.order.iter().cloned().collect(),
        };
        let json = serde_json::to_string(&index).map_err(|error| error.to_string())?;
        crate::exif_processing::write_text_file_atomic(&self.root.join("index-v1.json"), &json)
    }

    fn entry_path(&self, key: &str) -> PathBuf {
        entry_path_for(&self.root, key)
    }
}

fn validate_entry(
    entry: &FilmThumbnailEntry,
    expected: &FilmThumbnailLookup,
) -> Result<(), FilmThumbnailCacheRejection> {
    if entry.descriptor.renderer_version != expected.renderer_version {
        return Err(FilmThumbnailCacheRejection::RendererVersionMismatch);
    }
    if entry.descriptor.key != expected.key
        || entry.descriptor.width != expected.width
        || entry.descriptor.height != expected.height
        || entry.descriptor.output_identity != expected.output_identity
    {
        return Err(FilmThumbnailCacheRejection::HeaderMismatch);
    }
    if sha256_prefixed(entry.payload.as_slice()) != entry.descriptor.payload_sha256 {
        return Err(FilmThumbnailCacheRejection::CorruptPayload);
    }
    Ok(())
}

pub(crate) fn sha256_prefixed(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn entry_path_for(root: &Path, key: &str) -> PathBuf {
    root.join(format!(
        "{}.json",
        hex::encode(Sha256::digest(key.as_bytes()))
    ))
}

fn read_index(root: &Path) -> Option<VecDeque<String>> {
    let bytes = fs::read(root.join("index-v1.json")).ok()?;
    let index = serde_json::from_slice::<DiskIndexV1>(&bytes).ok()?;
    (index.schema_version == DISK_SCHEMA_VERSION).then(|| index.order.into())
}

fn remove_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(key: &str, payload: &[u8], pinned: bool) -> FilmThumbnailEntry {
        FilmThumbnailEntry {
            descriptor: FilmThumbnailDescriptor {
                key: key.to_string(),
                payload_sha256: sha256_prefixed(payload),
                width: 160,
                height: 96,
                renderer_version: "film-thumbnail-v1".to_string(),
                output_identity: "display-srgb-v1".to_string(),
            },
            payload: Arc::new(payload.to_vec()),
            pinned,
        }
    }

    fn lookup(key: &str) -> FilmThumbnailLookup {
        FilmThumbnailLookup {
            key: key.to_string(),
            width: 160,
            height: 96,
            renderer_version: "film-thumbnail-v1".to_string(),
            output_identity: "display-srgb-v1".to_string(),
        }
    }

    #[test]
    fn weighted_lru_preserves_pinned_entry_and_never_exceeds_budget() {
        let mut cache = FilmThumbnailCache::new(2, 8);
        cache.insert(entry("pinned", b"1234", true)).unwrap();
        cache.insert(entry("old", b"5678", false)).unwrap();
        cache.insert(entry("new", b"abcd", false)).unwrap();
        assert!(matches!(
            cache.get(&lookup("pinned")),
            FilmThumbnailCacheLookupResult::Hit(_)
        ));
        assert!(matches!(
            cache.get(&lookup("old")),
            FilmThumbnailCacheLookupResult::Miss
        ));
        assert!(matches!(
            cache.get(&lookup("new")),
            FilmThumbnailCacheLookupResult::Hit(_)
        ));
        assert!(cache.resident_bytes() <= 8 && cache.len() <= 2);
    }

    #[test]
    fn pinned_budget_exhaustion_rejects_new_entry_without_unbounded_growth() {
        let mut cache = FilmThumbnailCache::new(1, 4);
        cache.insert(entry("pinned", b"1234", true)).unwrap();
        assert_eq!(
            cache.insert(entry("new", b"abcd", true)),
            Err(FilmThumbnailCacheRejection::PinnedBudgetExhausted)
        );
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.resident_bytes(), 4);
        assert_eq!(
            cache.insert(entry("unpinned", b"abcd", false)),
            Err(FilmThumbnailCacheRejection::PinnedBudgetExhausted)
        );
        assert!(matches!(
            cache.get(&lookup("pinned")),
            FilmThumbnailCacheLookupResult::Hit(_)
        ));
        assert!(matches!(
            cache.get(&lookup("unpinned")),
            FilmThumbnailCacheLookupResult::Miss
        ));
    }

    #[test]
    fn corrupt_payload_and_old_renderer_are_removed_on_read() {
        let mut cache = FilmThumbnailCache::new(2, 64);
        let mut corrupt = entry("corrupt", b"payload", false);
        corrupt.descriptor.payload_sha256 = sha256_prefixed(b"other");
        cache.entries.insert("corrupt".into(), corrupt);
        cache.order.push_back("corrupt".into());
        cache.resident_bytes = 7;
        assert!(matches!(
            cache.get(&lookup("corrupt")),
            FilmThumbnailCacheLookupResult::Rejected(FilmThumbnailCacheRejection::CorruptPayload)
        ));
        cache.insert(entry("old", b"payload", false)).unwrap();
        let mut old = lookup("old");
        old.renderer_version = "film-thumbnail-v2".into();
        assert!(matches!(
            cache.get(&old),
            FilmThumbnailCacheLookupResult::Rejected(
                FilmThumbnailCacheRejection::RendererVersionMismatch
            )
        ));
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn disk_cache_evicts_lru_and_quarantines_corrupt_envelope() {
        let root = tempfile::tempdir().unwrap();
        let mut cache = FilmThumbnailDiskCache::open(root.path().to_path_buf(), 1, 4096).unwrap();
        cache
            .insert(&entry("first", b"first-payload", false))
            .unwrap();
        cache
            .insert(&entry("second", b"second-payload", false))
            .unwrap();
        assert!(matches!(
            cache.get(&lookup("first")).unwrap(),
            FilmThumbnailCacheLookupResult::Miss
        ));
        assert!(matches!(
            cache.get(&lookup("second")).unwrap(),
            FilmThumbnailCacheLookupResult::Hit(_)
        ));

        fs::write(cache.entry_path("second"), b"not-an-envelope").unwrap();
        assert!(matches!(
            cache.get(&lookup("second")).unwrap(),
            FilmThumbnailCacheLookupResult::Rejected(FilmThumbnailCacheRejection::HeaderMismatch)
        ));
        assert!(!cache.entry_path("second").exists());
    }

    #[test]
    fn corrupt_disk_index_discards_orphaned_private_derivatives() {
        let root = tempfile::tempdir().unwrap();
        let orphan_path = {
            let mut cache =
                FilmThumbnailDiskCache::open(root.path().to_path_buf(), 2, 4096).unwrap();
            cache
                .insert(&entry("orphan", b"private-derived-pixels", false))
                .unwrap();
            cache.entry_path("orphan")
        };
        assert!(orphan_path.exists());
        fs::write(root.path().join("index-v1.json"), b"corrupt-index").unwrap();
        let _cache = FilmThumbnailDiskCache::open(root.path().to_path_buf(), 2, 4096).unwrap();
        assert!(!orphan_path.exists());
    }
}
