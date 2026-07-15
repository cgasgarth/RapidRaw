//! Private ownership for Film scheduling and derived thumbnail caches.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use super::film_render_scheduler::{FilmRenderIdentityV1, FilmRenderLease, FilmRenderScheduler};
use super::film_thumbnail_cache::{
    FilmThumbnailCache, FilmThumbnailCacheLookupResult, FilmThumbnailDiskCache, FilmThumbnailEntry,
    FilmThumbnailLookup,
};

const MEMORY_ENTRY_BUDGET: usize = 48;
const MEMORY_BYTE_BUDGET: usize = 64 * 1024 * 1024;
const DISK_ENTRY_BUDGET: usize = 192;
const DISK_BYTE_BUDGET: u64 = 256 * 1024 * 1024;

struct DiskCacheSlot {
    root: PathBuf,
    cache: FilmThumbnailDiskCache,
}

struct FilmRuntimeServicesInner {
    scheduler: FilmRenderScheduler,
    thumbnails: Mutex<FilmThumbnailCache>,
    disk: Mutex<Option<DiskCacheSlot>>,
}

#[derive(Clone)]
pub(crate) struct FilmRuntimeServices {
    inner: Arc<FilmRuntimeServicesInner>,
}

impl Default for FilmRuntimeServices {
    fn default() -> Self {
        Self {
            inner: Arc::new(FilmRuntimeServicesInner {
                scheduler: FilmRenderScheduler::default(),
                thumbnails: Mutex::new(FilmThumbnailCache::new(
                    MEMORY_ENTRY_BUDGET,
                    MEMORY_BYTE_BUDGET,
                )),
                disk: Mutex::new(None),
            }),
        }
    }
}

impl FilmRuntimeServices {
    pub(crate) fn begin(
        &self,
        request_id: String,
        lane: String,
        identity: FilmRenderIdentityV1,
    ) -> Result<FilmRenderLease, &'static str> {
        self.inner.scheduler.begin(request_id, lane, identity)
    }

    pub(crate) fn cancel(&self, request_id: &str) -> bool {
        self.inner.scheduler.cancel(request_id)
    }

    pub(crate) fn is_current(&self, lease: &FilmRenderLease) -> bool {
        self.inner.scheduler.is_current(lease)
    }

    pub(crate) fn claim_current(&self, lease: &FilmRenderLease) -> bool {
        self.inner.scheduler.claim_current(lease)
    }

    pub(crate) fn finish(&self, lease: &FilmRenderLease) -> bool {
        self.inner.scheduler.finish(lease)
    }

    pub(crate) fn thumbnail(
        &self,
        expected: &FilmThumbnailLookup,
        disk_root: &Path,
    ) -> Result<FilmThumbnailCacheLookupResult, String> {
        let memory = self
            .inner
            .thumbnails
            .lock()
            .expect("film thumbnail cache poisoned")
            .get(expected);
        if matches!(memory, FilmThumbnailCacheLookupResult::Hit(_)) {
            return Ok(memory);
        }
        let disk = self.with_disk_cache(disk_root, |cache| cache.get(expected))??;
        if let FilmThumbnailCacheLookupResult::Hit(entry) = &disk {
            let _ = self
                .inner
                .thumbnails
                .lock()
                .expect("film thumbnail cache poisoned")
                .insert(entry.clone());
        }
        Ok(disk)
    }

    pub(crate) fn publish_thumbnail(
        &self,
        entry: FilmThumbnailEntry,
        disk_root: &Path,
    ) -> Result<(), String> {
        self.with_disk_cache(disk_root, |cache| cache.insert(&entry))??;
        let _ = self
            .inner
            .thumbnails
            .lock()
            .expect("film thumbnail cache poisoned")
            .insert(entry);
        Ok(())
    }

    pub(crate) fn set_thumbnail_pinned(&self, key: &str, pinned: bool) -> bool {
        self.inner
            .thumbnails
            .lock()
            .expect("film thumbnail cache poisoned")
            .set_pinned(key, pinned)
    }

    pub(crate) fn handle_memory_pressure(&self) {
        self.inner
            .thumbnails
            .lock()
            .expect("film thumbnail cache poisoned")
            .clear_unpinned();
    }

    fn with_disk_cache<T>(
        &self,
        root: &Path,
        operation: impl FnOnce(&mut FilmThumbnailDiskCache) -> T,
    ) -> Result<T, String> {
        let mut slot = self.inner.disk.lock().expect("film disk cache poisoned");
        if slot.as_ref().is_none_or(|slot| slot.root != root) {
            *slot = Some(DiskCacheSlot {
                root: root.to_path_buf(),
                cache: FilmThumbnailDiskCache::open(
                    root.to_path_buf(),
                    DISK_ENTRY_BUDGET,
                    DISK_BYTE_BUDGET,
                )?,
            });
        }
        Ok(operation(
            &mut slot.as_mut().expect("disk cache installed").cache,
        ))
    }
}
