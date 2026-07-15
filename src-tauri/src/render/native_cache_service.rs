use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use image::{DynamicImage, GrayImage};

use crate::cache_utils::DecodedImageCache;
use crate::lut_processing::{self, CachedLutPath, Lut};
use crate::raw_processing::RawDevelopmentReport;
use crate::render::native_cache::{
    CacheBudgetCoordinator, CachePolicy, CacheStats, MemoryLruCache,
};
use crate::source_revision::{DecodedImageKey, SourceRevision};

pub(crate) type DecodedImageSnapshot = (
    Arc<DynamicImage>,
    Arc<HashMap<String, String>>,
    Option<Arc<RawDevelopmentReport>>,
);

pub(crate) struct NativeCacheService {
    budget: Arc<CacheBudgetCoordinator>,
    lut_paths: MemoryLruCache<String, CachedLutPath>,
    lut_content: MemoryLruCache<[u8; 32], Lut>,
    lut_publication: Mutex<()>,
    masks: MemoryLruCache<u64, GrayImage>,
    geometry: MemoryLruCache<u64, DynamicImage>,
    thumbnail_geometry: MemoryLruCache<String, (u64, Arc<DynamicImage>, f32)>,
    decoded: DecodedImageCache,
}

impl Default for NativeCacheService {
    fn default() -> Self {
        let mib = 1024 * 1024;
        let budget = CacheBudgetCoordinator::new(768 * mib, 1024 * mib);
        let policy = |name, soft, hard, max_entries| CachePolicy {
            name,
            soft_limit_bytes: soft * mib,
            hard_limit_bytes: hard * mib,
            max_entries,
        };
        Self {
            lut_paths: MemoryLruCache::new(
                policy("lut_paths", 1, 2, Some(64)),
                Arc::clone(&budget),
            ),
            lut_content: MemoryLruCache::new(
                policy("lut_cpu", 64, 96, Some(32)),
                Arc::clone(&budget),
            ),
            lut_publication: Mutex::new(()),
            masks: MemoryLruCache::new(policy("masks", 96, 128, Some(64)), Arc::clone(&budget)),
            geometry: MemoryLruCache::new(
                policy("geometry", 256, 384, Some(16)),
                Arc::clone(&budget),
            ),
            thumbnail_geometry: MemoryLruCache::new(
                policy("thumbnail_geometry", 192, 256, Some(96)),
                Arc::clone(&budget),
            ),
            decoded: DecodedImageCache::new(5, Arc::clone(&budget)),
            budget,
        }
    }
}

impl NativeCacheService {
    pub(crate) fn budget(&self) -> Arc<CacheBudgetCoordinator> {
        Arc::clone(&self.budget)
    }

    pub(crate) fn budget_usage(&self) -> (u64, (u64, u64)) {
        (self.budget.current_bytes(), self.budget.limits())
    }

    pub(crate) fn stats(&self) -> Vec<CacheStats> {
        vec![
            self.geometry.stats(),
            self.thumbnail_geometry.stats(),
            self.masks.stats(),
            self.lut_paths.stats(),
            self.lut_content.stats(),
            self.decoded.stats(),
        ]
    }

    pub(crate) fn get_or_load_lut(&self, path: &str) -> Result<Arc<Lut>, String> {
        self.get_or_load_lut_with_before_publication(path, || {})
    }

    fn get_or_load_lut_with_before_publication(
        &self,
        path: &str,
        before_publication: impl Fn(),
    ) -> Result<Arc<Lut>, String> {
        const MAX_SOURCE_CHANGE_RETRIES: usize = 3;

        for _ in 0..MAX_SOURCE_CHANGE_RETRIES {
            let fingerprint =
                lut_processing::source_fingerprint(path).map_err(|error| error.to_string())?;
            if let Some(entry) = self.lut_paths.get(&path.to_string())
                && entry.fingerprint == fingerprint
            {
                return Ok(Arc::clone(&entry.lut));
            }

            let parsed = lut_processing::parse_lut_file(path).map_err(|error| error.to_string())?;
            let confirmed_fingerprint =
                lut_processing::source_fingerprint(path).map_err(|error| error.to_string())?;
            if confirmed_fingerprint != fingerprint {
                continue;
            }

            before_publication();
            let _publication = self.lut_publication.lock().unwrap();
            // Metadata I/O is intentionally inside this narrow publication section: an older
            // parser must not overwrite a newer path authority after waiting for this lock.
            let publication_fingerprint =
                lut_processing::source_fingerprint(path).map_err(|error| error.to_string())?;
            if publication_fingerprint != fingerprint {
                continue;
            }
            if let Some(entry) = self.lut_paths.get(&path.to_string())
                && entry.fingerprint == fingerprint
            {
                return Ok(Arc::clone(&entry.lut));
            }

            let content_hash = parsed.content_hash;
            let lut = self.lut_content.get(&content_hash).unwrap_or_else(|| {
                let lut = Arc::new(parsed);
                self.lut_content
                    .insert(content_hash, Arc::clone(&lut), lut.retained_bytes());
                lut
            });
            self.lut_paths.insert(
                path.to_string(),
                Arc::new(CachedLutPath {
                    fingerprint,
                    lut: Arc::clone(&lut),
                }),
                256,
            );
            return Ok(lut);
        }

        Err(format!("lut_source_changed_during_load:{path}"))
    }

    pub(crate) fn mask(&self, key: u64) -> Option<Arc<GrayImage>> {
        self.masks.get(&key)
    }

    pub(crate) fn insert_mask(&self, key: u64, mask: Arc<GrayImage>) {
        let weight = mask.as_raw().len() as u64;
        self.masks.insert(key, mask, weight);
    }

    pub(crate) fn geometry(&self, key: u64) -> Option<Arc<DynamicImage>> {
        self.geometry.get(&key)
    }

    pub(crate) fn insert_geometry(&self, key: u64, image: Arc<DynamicImage>) {
        let weight = image.as_bytes().len() as u64;
        self.geometry.insert(key, image, weight);
    }

    pub(crate) fn thumbnail_geometry(
        &self,
        path: &str,
    ) -> Option<Arc<(u64, Arc<DynamicImage>, f32)>> {
        self.thumbnail_geometry.get(&path.to_string())
    }

    pub(crate) fn insert_thumbnail_geometry(
        &self,
        path: String,
        geometry: Arc<(u64, Arc<DynamicImage>, f32)>,
    ) {
        let weight = geometry.1.as_bytes().len() as u64;
        self.thumbnail_geometry.insert(path, geometry, weight);
    }

    pub(crate) fn decoded(&self, key: &DecodedImageKey) -> Option<DecodedImageSnapshot> {
        self.decoded.get(key)
    }

    pub(crate) fn insert_decoded(
        &self,
        key: DecodedImageKey,
        image: Arc<DynamicImage>,
        exif: HashMap<String, String>,
        report: Option<RawDevelopmentReport>,
    ) {
        self.decoded.insert(key, image, exif, report);
    }

    pub(crate) fn contains_decoded_revision(&self, revision: &SourceRevision) -> bool {
        self.decoded.contains_revision(revision)
    }

    pub(crate) fn set_decoded_capacity(&self, capacity: usize) {
        self.decoded.set_capacity(capacity);
    }

    pub(crate) fn clear_decoded(&self) {
        self.decoded.clear();
    }

    pub(crate) fn clear_session_derivatives(&self) {
        self.masks.clear();
        self.geometry.clear();
    }

    pub(crate) fn clear_thumbnail_geometry(&self) {
        self.thumbnail_geometry.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Barrier;

    fn write_test_lut(path: &std::path::Path, middle: f32) {
        let mut cube = String::from("LUT_3D_SIZE 2\n");
        for _ in 0..8 {
            cube.push_str(&format!("0 {middle} 1\n"));
        }
        std::fs::write(path, cube).unwrap();
    }

    #[test]
    fn cache_family_accounts_shared_budget_and_clears_session_domains_only() {
        let service = NativeCacheService::default();
        service.insert_geometry(1, Arc::new(DynamicImage::new_rgb8(8, 8)));
        service.insert_mask(2, Arc::new(GrayImage::new(8, 8)));
        service.insert_thumbnail_geometry(
            "thumb".to_string(),
            Arc::new((3, Arc::new(DynamicImage::new_rgb8(8, 8)), 1.0)),
        );
        assert!(service.budget_usage().0 > 0);

        service.clear_session_derivatives();
        assert!(service.geometry(1).is_none());
        assert!(service.mask(2).is_none());
        assert!(service.thumbnail_geometry("thumb").is_some());
    }

    #[test]
    fn concurrent_cache_publication_remains_clearable_without_cross_domain_locking() {
        let service = Arc::new(NativeCacheService::default());
        let barrier = Arc::new(Barrier::new(8));
        let workers: Vec<_> = (0..8)
            .map(|key| {
                let service = Arc::clone(&service);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    service.insert_geometry(key, Arc::new(DynamicImage::new_rgb8(16, 16)));
                    service.insert_mask(key, Arc::new(GrayImage::new(16, 16)));
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert!(service.budget_usage().0 > 0);

        service.clear_session_derivatives();
        for key in 0..8 {
            assert!(service.geometry(key).is_none());
            assert!(service.mask(key).is_none());
        }
        assert_eq!(service.budget_usage().0, 0);
    }

    #[test]
    fn lut_cache_reuses_content_and_invalidates_replaced_path() {
        let temp = tempfile::tempdir().unwrap();
        let first_path = temp.path().join("first.cube");
        let alias_path = temp.path().join("alias.cube");
        write_test_lut(&first_path, 0.5);
        write_test_lut(&alias_path, 0.5);
        let service = NativeCacheService::default();

        let first = service
            .get_or_load_lut(first_path.to_str().unwrap())
            .unwrap();
        let warm = service
            .get_or_load_lut(first_path.to_str().unwrap())
            .unwrap();
        let alias = service
            .get_or_load_lut(alias_path.to_str().unwrap())
            .unwrap();
        assert!(Arc::ptr_eq(&first, &warm));
        assert!(Arc::ptr_eq(&first, &alias));

        let replacement = temp.path().join("replacement.cube");
        write_test_lut(&replacement, 0.25);
        std::fs::rename(&replacement, &first_path).unwrap();
        let changed = service
            .get_or_load_lut(first_path.to_str().unwrap())
            .unwrap();
        assert!(!Arc::ptr_eq(&first, &changed));
        assert_ne!(first.content_hash, changed.content_hash);
    }

    #[test]
    fn concurrent_aliases_of_replaced_content_publish_one_lut_revision() {
        let temp = tempfile::tempdir().unwrap();
        let first_path = temp.path().join("first.cube");
        write_test_lut(&first_path, 0.5);
        let service = Arc::new(NativeCacheService::default());
        let original = service
            .get_or_load_lut(first_path.to_str().unwrap())
            .unwrap();

        let replacement = temp.path().join("replacement.cube");
        write_test_lut(&replacement, 0.25);
        std::fs::rename(&replacement, &first_path).unwrap();
        let mut paths = vec![first_path];
        for index in 0..7 {
            let alias = temp.path().join(format!("alias-{index}.cube"));
            write_test_lut(&alias, 0.25);
            paths.push(alias);
        }

        let barrier = Arc::new(Barrier::new(paths.len()));
        let workers: Vec<_> = paths
            .into_iter()
            .map(|path| {
                let service = Arc::clone(&service);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    service.get_or_load_lut(path.to_str().unwrap()).unwrap()
                })
            })
            .collect();
        let published: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();

        assert_ne!(published[0].content_hash, original.content_hash);
        assert!(published.iter().all(|lut| Arc::ptr_eq(lut, &published[0])));
        assert_eq!(
            service
                .stats()
                .into_iter()
                .find(|stats| stats.name == "lut_cpu")
                .unwrap()
                .entries,
            2
        );
    }

    #[test]
    fn stale_waiter_cannot_overwrite_newer_path_publication() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("racing.cube");
        write_test_lut(&path, 0.5);
        let service = Arc::new(NativeCacheService::default());
        let old_ready = Arc::new(Barrier::new(2));
        let release_old = Arc::new(Barrier::new(2));
        let first_attempt = Arc::new(AtomicBool::new(true));

        let old_service = Arc::clone(&service);
        let old_path = path.clone();
        let old_ready_worker = Arc::clone(&old_ready);
        let release_old_worker = Arc::clone(&release_old);
        let first_attempt_worker = Arc::clone(&first_attempt);
        let old_waiter = std::thread::spawn(move || {
            old_service
                .get_or_load_lut_with_before_publication(old_path.to_str().unwrap(), || {
                    if first_attempt_worker.swap(false, Ordering::AcqRel) {
                        old_ready_worker.wait();
                        release_old_worker.wait();
                    }
                })
                .unwrap()
        });

        old_ready.wait();
        let replacement = temp.path().join("replacement.cube");
        write_test_lut(&replacement, 0.25);
        std::fs::rename(&replacement, &path).unwrap();
        let newer = service.get_or_load_lut(path.to_str().unwrap()).unwrap();
        release_old.wait();

        let recovered = old_waiter.join().unwrap();
        let authoritative = service.get_or_load_lut(path.to_str().unwrap()).unwrap();
        assert!(Arc::ptr_eq(&recovered, &newer));
        assert!(Arc::ptr_eq(&authoritative, &newer));
    }
}
