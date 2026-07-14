//! Deterministic bounded cache for immutable compiled Film resources.

#![allow(dead_code)]

use super::film_profile_compiler::CompiledFilmProfileV1;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

#[derive(Debug)]
pub struct FilmResourceCacheV1 {
    capacity: usize,
    entries: HashMap<String, Arc<CompiledFilmProfileV1>>,
    lru: VecDeque<String>,
    pinned: HashMap<String, usize>,
}

impl FilmResourceCacheV1 {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            entries: HashMap::new(),
            lru: VecDeque::new(),
            pinned: HashMap::new(),
        }
    }

    pub fn get(&mut self, key: &str) -> Option<Arc<CompiledFilmProfileV1>> {
        let entry = self.entries.get(key).cloned();
        if entry.is_some() {
            self.touch(key);
        }
        entry
    }

    pub fn insert(&mut self, key: String, value: Arc<CompiledFilmProfileV1>) {
        self.entries.insert(key.clone(), value);
        self.touch(&key);
        self.evict();
    }

    pub fn pin(&mut self, key: &str) -> bool {
        if self.entries.contains_key(key) {
            *self.pinned.entry(key.to_string()).or_default() += 1;
            true
        } else {
            false
        }
    }

    pub fn unpin(&mut self, key: &str) {
        if let Some(count) = self.pinned.get_mut(key) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                self.pinned.remove(key);
            }
        }
        self.evict();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    fn touch(&mut self, key: &str) {
        self.lru.retain(|candidate| candidate != key);
        self.lru.push_back(key.to_string());
    }

    fn evict(&mut self) {
        while self.entries.len() > self.capacity {
            let Some(candidate) = self.lru.pop_front() else {
                break;
            };
            if self.pinned.contains_key(&candidate) {
                self.lru.push_back(candidate);
                if self.lru.iter().all(|key| self.pinned.contains_key(key)) {
                    break;
                }
                continue;
            }
            self.entries.remove(&candidate);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::film_profile_compiler::*;

    fn resource(id: &str) -> Arc<CompiledFilmProfileV1> {
        Arc::new(CompiledFilmProfileV1 {
            profile_id: id.into(),
            profile_version: "1".into(),
            manifest_content_sha256: id.into(),
            decoded_asset_sha256: Default::default(),
            model_abi_version: MODEL_ABI_VERSION.into(),
            compiler_version: COMPILER_VERSION.into(),
            numeric_policy_version: NUMERIC_POLICY_VERSION.into(),
            working_space: "acescg_linear_v1".into(),
            compiled_content_sha256: id.into(),
        })
    }

    #[test]
    fn lru_eviction_preserves_pinned_resources() {
        let mut cache = FilmResourceCacheV1::new(2);
        cache.insert("a".into(), resource("a"));
        cache.insert("b".into(), resource("b"));
        assert!(cache.pin("a"));
        cache.insert("c".into(), resource("c"));
        assert!(cache.get("a").is_some());
        assert!(cache.get("c").is_some());
        assert!(cache.get("b").is_none());
        cache.unpin("a");
        cache.insert("d".into(), resource("d"));
        assert!(cache.len() <= 2);
    }
}
