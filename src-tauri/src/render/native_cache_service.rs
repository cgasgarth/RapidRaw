use std::collections::HashMap;
use std::sync::Arc;

use image::{DynamicImage, GrayImage};

use crate::cache_utils::DecodedImageCache;
use crate::lut_processing::{CachedLutPath, Lut};
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

    pub(crate) fn lut_path(&self, path: &str) -> Option<Arc<CachedLutPath>> {
        self.lut_paths.get(&path.to_string())
    }

    pub(crate) fn insert_lut_path(&self, path: String, value: Arc<CachedLutPath>) {
        self.lut_paths.insert(path, value, 256);
    }

    pub(crate) fn lut_content(&self, hash: &[u8; 32]) -> Option<Arc<Lut>> {
        self.lut_content.get(hash)
    }

    pub(crate) fn insert_lut_content(&self, hash: [u8; 32], lut: Arc<Lut>, weight: u64) {
        self.lut_content.insert(hash, lut, weight);
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
}
