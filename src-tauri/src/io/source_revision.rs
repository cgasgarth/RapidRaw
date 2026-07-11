use std::collections::{HashMap, VecDeque};
use std::fs::Metadata;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub const SOURCE_REVISION_POLICY: &str = "metadata-v1";
static STRONG_HASH_COUNT: AtomicU64 = AtomicU64::new(0);
static STRONG_HASH_BYTES: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FingerprintMetrics {
    pub strong_hash_count: u64,
    pub strong_hash_bytes: u64,
}

#[cfg(test)]
pub fn fingerprint_metrics() -> FingerprintMetrics {
    FingerprintMetrics {
        strong_hash_count: STRONG_HASH_COUNT.load(Ordering::Relaxed),
        strong_hash_bytes: STRONG_HASH_BYTES.load(Ordering::Relaxed),
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct FileId {
    pub volume: u64,
    pub file: u64,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct SourceRevision {
    pub canonical_path: Arc<PathBuf>,
    pub file_id: Option<FileId>,
    pub byte_len: u64,
    pub modified_ns: u128,
    pub created_ns: Option<u128>,
    pub policy: &'static str,
}

#[derive(Debug)]
pub enum SourceRevisionError {
    Metadata {
        path: PathBuf,
        source: std::io::Error,
    },
}

impl std::fmt::Display for SourceRevisionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Metadata { path, source } => {
                write!(
                    formatter,
                    "source_metadata_failed:{}:{source}",
                    path.display()
                )
            }
        }
    }
}

impl std::error::Error for SourceRevisionError {}

impl SourceRevision {
    pub fn from_path(path: &Path) -> Result<Self, SourceRevisionError> {
        let started = Instant::now();
        let metadata = std::fs::metadata(path).map_err(|source| SourceRevisionError::Metadata {
            path: absolute_path(path),
            source,
        })?;
        let canonical_path = std::fs::canonicalize(path).unwrap_or_else(|_| absolute_path(path));
        let revision = Self::from_metadata(canonical_path, &metadata);
        log::trace!(
            "source_revision_stat path={} elapsed_us={}",
            revision.canonical_path.display(),
            started.elapsed().as_micros()
        );
        Ok(revision)
    }

    fn from_metadata(path: PathBuf, metadata: &Metadata) -> Self {
        Self {
            canonical_path: Arc::new(path),
            file_id: platform_file_id(metadata),
            byte_len: metadata.len(),
            modified_ns: timestamp_ns(metadata.modified().ok()).unwrap_or(0),
            created_ns: timestamp_ns(metadata.created().ok()),
            policy: SOURCE_REVISION_POLICY,
        }
    }
}

fn absolute_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    }
}

fn timestamp_ns(value: Option<SystemTime>) -> Option<u128> {
    value?.duration_since(UNIX_EPOCH).ok().map(|v| v.as_nanos())
}

#[cfg(unix)]
fn platform_file_id(metadata: &Metadata) -> Option<FileId> {
    use std::os::unix::fs::MetadataExt;
    Some(FileId {
        volume: metadata.dev(),
        file: metadata.ino(),
    })
}

#[cfg(windows)]
fn platform_file_id(metadata: &Metadata) -> Option<FileId> {
    use std::os::windows::fs::MetadataExt;
    Some(FileId {
        volume: u64::from(metadata.volume_serial_number()?),
        file: metadata.file_index()?,
    })
}

#[cfg(not(any(unix, windows)))]
fn platform_file_id(_metadata: &Metadata) -> Option<FileId> {
    None
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct RawProcessingProfileKey {
    pub mode: &'static str,
    pub linear_raw_mode: String,
    pub highlight_compression_bits: u32,
    pub color_nr_bits: u32,
    pub sharpening_bits: [u32; 4],
    pub camera_profile_resolver_version: &'static str,
    pub reconstruction_version: &'static str,
    pub demosaic_plan_version: &'static str,
    pub decoder_version: &'static str,
    pub input_transform_version: &'static str,
    pub xyz_to_ap1_version: &'static str,
    pub numeric_policy_version: &'static str,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct DecodedImageKey {
    pub source_revision: SourceRevision,
    pub processing_profile: RawProcessingProfileKey,
}

#[derive(Clone, Debug)]
pub struct VerifiedSourceFingerprint {
    pub revision: SourceRevision,
    pub blake3: blake3::Hash,
}

enum FingerprintState {
    Computing,
    Ready(blake3::Hash),
}

struct FingerprintCacheInner {
    entries: HashMap<SourceRevision, FingerprintState>,
    lru: VecDeque<SourceRevision>,
}

pub struct FingerprintCache {
    capacity: usize,
    inner: Mutex<FingerprintCacheInner>,
    ready: Condvar,
}

impl FingerprintCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            inner: Mutex::new(FingerprintCacheInner {
                entries: HashMap::new(),
                lru: VecDeque::new(),
            }),
            ready: Condvar::new(),
        }
    }

    pub fn fingerprint(
        &self,
        revision: &SourceRevision,
        bytes: &[u8],
    ) -> VerifiedSourceFingerprint {
        loop {
            let mut inner = self.inner.lock().unwrap();
            match inner.entries.get(revision) {
                Some(FingerprintState::Ready(hash)) => {
                    let hash = *hash;
                    touch(&mut inner.lru, revision);
                    log::trace!("source_fingerprint_cache_hit bytes={}", bytes.len());
                    return VerifiedSourceFingerprint {
                        revision: revision.clone(),
                        blake3: hash,
                    };
                }
                Some(FingerprintState::Computing) => {
                    inner = self.ready.wait(inner).unwrap();
                    drop(inner);
                    continue;
                }
                None => {
                    inner
                        .entries
                        .insert(revision.clone(), FingerprintState::Computing);
                    break;
                }
            }
        }

        let started = Instant::now();
        STRONG_HASH_COUNT.fetch_add(1, Ordering::Relaxed);
        STRONG_HASH_BYTES.fetch_add(bytes.len() as u64, Ordering::Relaxed);
        let hash = blake3::hash(bytes);
        log::debug!(
            "source_strong_hash bytes={} elapsed_us={}",
            bytes.len(),
            started.elapsed().as_micros()
        );
        let mut inner = self.inner.lock().unwrap();
        inner
            .entries
            .insert(revision.clone(), FingerprintState::Ready(hash));
        touch(&mut inner.lru, revision);
        while inner.lru.len() > self.capacity {
            if let Some(evicted) = inner.lru.pop_front() {
                inner.entries.remove(&evicted);
            }
        }
        self.ready.notify_all();
        VerifiedSourceFingerprint {
            revision: revision.clone(),
            blake3: hash,
        }
    }
}

fn touch(lru: &mut VecDeque<SourceRevision>, revision: &SourceRevision) {
    if let Some(position) = lru.iter().position(|candidate| candidate == revision) {
        lru.remove(position);
    }
    lru.push_back(revision.clone());
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy;
    use std::io::Write;

    static METRICS_TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    #[test]
    fn revision_is_stable_and_detects_mutation_and_replacement() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("source.raw");
        std::fs::write(&path, b"first").unwrap();
        let first = SourceRevision::from_path(&path).unwrap();
        assert_eq!(first, SourceRevision::from_path(&path).unwrap());

        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        file.write_all(b"-changed").unwrap();
        file.sync_all().unwrap();
        assert_ne!(first, SourceRevision::from_path(&path).unwrap());

        let replacement = directory.path().join("replacement.raw");
        std::fs::write(&replacement, b"other").unwrap();
        std::fs::rename(&replacement, &path).unwrap();
        assert_ne!(
            first.file_id,
            SourceRevision::from_path(&path).unwrap().file_id
        );
    }

    #[test]
    fn missing_paths_have_typed_path_specific_errors() {
        let directory = tempfile::tempdir().unwrap();
        let a = SourceRevision::from_path(&directory.path().join("a.raw")).unwrap_err();
        let b = SourceRevision::from_path(&directory.path().join("b.raw")).unwrap_err();
        assert_ne!(a.to_string(), b.to_string());
    }

    #[test]
    fn fingerprint_cache_reuses_hash_and_is_bounded() {
        let _guard = METRICS_TEST_LOCK.lock().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("source.raw");
        std::fs::write(&path, b"payload").unwrap();
        let revision = SourceRevision::from_path(&path).unwrap();
        let cache = FingerprintCache::new(1);
        let before = fingerprint_metrics();
        let first = cache.fingerprint(&revision, b"payload");
        let second = cache.fingerprint(&revision, b"different bytes are not rehashed");
        let after = fingerprint_metrics();
        assert_eq!(first.blake3, second.blake3);
        assert_eq!(first.revision, revision);
        assert_eq!(after.strong_hash_count - before.strong_hash_count, 1);
        assert_eq!(after.strong_hash_bytes - before.strong_hash_bytes, 7);
    }

    #[test]
    fn metadata_lookup_performs_no_strong_hash() {
        let _guard = METRICS_TEST_LOCK.lock().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("source.raw");
        std::fs::write(&path, b"payload").unwrap();
        let before = fingerprint_metrics();
        for _ in 0..10 {
            SourceRevision::from_path(&path).unwrap();
        }
        assert_eq!(fingerprint_metrics(), before);
    }

    #[test]
    #[ignore = "manual runtime benchmark"]
    fn benchmark_metadata_lookup_against_payload_read_and_hash() {
        for size_mib in [25_u64, 75, 150] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("fixture.raw");
            let file = std::fs::File::create(&path).unwrap();
            file.set_len(size_mib * 1024 * 1024).unwrap();

            let iterations = 5;
            let old_started = Instant::now();
            for _ in 0..iterations {
                let bytes = std::fs::read(&path).unwrap();
                std::hint::black_box(blake3::hash(&bytes));
            }
            let old_elapsed = old_started.elapsed();

            let new_started = Instant::now();
            for _ in 0..iterations {
                std::hint::black_box(SourceRevision::from_path(&path).unwrap());
            }
            let new_elapsed = new_started.elapsed();
            println!(
                "source_revision_benchmark size_mib={size_mib} iterations={iterations} old_payload_bytes={} old_us={} new_payload_bytes=0 new_us={} speedup={:.1}x",
                size_mib * 1024 * 1024 * iterations,
                old_elapsed.as_micros(),
                new_elapsed.as_micros(),
                old_elapsed.as_secs_f64() / new_elapsed.as_secs_f64()
            );
        }
    }
}
