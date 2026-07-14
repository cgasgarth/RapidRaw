//! Bounded, identity-keyed thumbnail result cache. Payload ownership stays above this boundary.

#![allow(dead_code)]

use std::collections::{HashMap, VecDeque};

#[derive(Default)]
pub(crate) struct FilmThumbnailCache {
    capacity: usize,
    order: VecDeque<String>,
    entries: HashMap<String, (String, bool)>,
}

impl FilmThumbnailCache {
    pub(crate) fn new(capacity: usize) -> Self {
        Self {
            capacity,
            ..Self::default()
        }
    }

    pub(crate) fn insert(&mut self, key: String, payload_hash: String, pinned: bool) {
        self.entries.insert(key.clone(), (payload_hash, pinned));
        self.order.retain(|current| current != &key);
        self.order.push_back(key);
        self.evict_unpinned();
    }

    pub(crate) fn contains(&self, key: &str, payload_hash: &str) -> bool {
        self.entries
            .get(key)
            .is_some_and(|(hash, _)| hash == payload_hash)
    }

    fn evict_unpinned(&mut self) {
        while self.entries.len() > self.capacity {
            let Some(candidate) = self.order.pop_front() else {
                break;
            };
            if self
                .entries
                .get(&candidate)
                .is_some_and(|(_, pinned)| *pinned)
            {
                self.order.push_back(candidate);
            } else {
                self.entries.remove(&candidate);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_cache_preserves_pinned_and_rejects_hash_mismatch() {
        let mut cache = FilmThumbnailCache::new(1);
        cache.insert("pinned".into(), "hash-a".into(), true);
        cache.insert("evictable".into(), "hash-b".into(), false);
        assert!(cache.contains("pinned", "hash-a"));
        assert!(!cache.contains("evictable", "hash-b"));
        assert!(!cache.contains("pinned", "hash-wrong"));
    }
}
