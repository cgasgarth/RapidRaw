use serde::Serialize;
use std::collections::HashMap;
use std::hash::Hash;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub trait CacheWeight {
    fn retained_bytes(&self) -> u64;
}

impl CacheWeight for image::DynamicImage {
    fn retained_bytes(&self) -> u64 {
        self.as_bytes().len() as u64
    }
}

impl CacheWeight for image::GrayImage {
    fn retained_bytes(&self) -> u64 {
        self.as_raw().capacity() as u64
    }
}

#[derive(Clone, Copy, Debug)]
pub struct CachePolicy {
    pub name: &'static str,
    pub soft_limit_bytes: u64,
    pub hard_limit_bytes: u64,
    pub max_entries: Option<usize>,
}

#[derive(Default)]
pub struct CacheBudgetCoordinator {
    soft_limit: AtomicU64,
    hard_limit: AtomicU64,
    current_bytes: AtomicU64,
}

impl CacheBudgetCoordinator {
    pub fn new(soft_limit: u64, hard_limit: u64) -> Arc<Self> {
        Arc::new(Self {
            soft_limit: AtomicU64::new(soft_limit),
            hard_limit: AtomicU64::new(hard_limit),
            current_bytes: AtomicU64::new(0),
        })
    }

    pub fn current_bytes(&self) -> u64 {
        self.current_bytes.load(Ordering::Relaxed)
    }

    pub fn limits(&self) -> (u64, u64) {
        (
            self.soft_limit.load(Ordering::Relaxed),
            self.hard_limit.load(Ordering::Relaxed),
        )
    }

    fn add(&self, bytes: u64) {
        self.current_bytes.fetch_add(bytes, Ordering::Relaxed);
    }
    fn subtract(&self, bytes: u64) {
        self.current_bytes.fetch_sub(bytes, Ordering::Relaxed);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InsertOutcome {
    Admitted,
    Replaced,
    RejectedOversized,
    RejectedGlobalLimit,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct CacheStats {
    pub name: &'static str,
    pub entries: usize,
    pub bytes: u64,
    pub soft_limit_bytes: u64,
    pub hard_limit_bytes: u64,
    pub hits: u64,
    pub misses: u64,
    pub admissions: u64,
    pub replacements: u64,
    pub oversized_rejects: u64,
    pub evictions: u64,
    pub clears: u64,
}

struct Node<K, V> {
    key: K,
    value: Arc<V>,
    weight: u64,
    prev: Option<usize>,
    next: Option<usize>,
}
struct Inner<K, V> {
    map: HashMap<K, usize>,
    nodes: Vec<Option<Node<K, V>>>,
    free: Vec<usize>,
    head: Option<usize>,
    tail: Option<usize>,
    bytes: u64,
    stats: CacheStats,
}

pub struct MemoryLruCache<K, V> {
    inner: Mutex<Inner<K, V>>,
    policy: CachePolicy,
    coordinator: Arc<CacheBudgetCoordinator>,
}

impl<K: Eq + Hash + Clone, V> MemoryLruCache<K, V> {
    pub fn new(policy: CachePolicy, coordinator: Arc<CacheBudgetCoordinator>) -> Self {
        let stats = CacheStats {
            name: policy.name,
            soft_limit_bytes: policy.soft_limit_bytes,
            hard_limit_bytes: policy.hard_limit_bytes,
            ..Default::default()
        };
        Self {
            inner: Mutex::new(Inner {
                map: HashMap::new(),
                nodes: Vec::new(),
                free: Vec::new(),
                head: None,
                tail: None,
                bytes: 0,
                stats,
            }),
            policy,
            coordinator,
        }
    }

    pub fn get(&self, key: &K) -> Option<Arc<V>> {
        let mut inner = self.inner.lock().unwrap();
        let Some(&index) = inner.map.get(key) else {
            inner.stats.misses += 1;
            return None;
        };
        inner.stats.hits += 1;
        Self::touch(&mut inner, index);
        Some(Arc::clone(&inner.nodes[index].as_ref().unwrap().value))
    }

    pub fn peek(&self, key: &K) -> Option<Arc<V>> {
        let inner = self.inner.lock().unwrap();
        inner
            .map
            .get(key)
            .map(|&i| Arc::clone(&inner.nodes[i].as_ref().unwrap().value))
    }

    pub fn insert(&self, key: K, value: Arc<V>, weight: u64) -> InsertOutcome {
        if weight > self.policy.hard_limit_bytes {
            self.inner.lock().unwrap().stats.oversized_rejects += 1;
            return InsertOutcome::RejectedOversized;
        }
        let mut inner = self.inner.lock().unwrap();
        let replaced = inner.map.contains_key(&key);
        let replaced_weight = inner
            .map
            .get(&key)
            .map(|&index| inner.nodes[index].as_ref().unwrap().weight)
            .unwrap_or(0);
        while self
            .coordinator
            .current_bytes()
            .saturating_sub(replaced_weight)
            .saturating_add(weight)
            > self.coordinator.hard_limit.load(Ordering::Relaxed)
            && inner.head.is_some()
            && inner.map.len() > usize::from(replaced)
        {
            Self::evict_head(&mut inner, &self.coordinator);
        }
        if self
            .coordinator
            .current_bytes()
            .saturating_sub(replaced_weight)
            .saturating_add(weight)
            > self.coordinator.hard_limit.load(Ordering::Relaxed)
        {
            return InsertOutcome::RejectedGlobalLimit;
        }
        if replaced {
            Self::remove_key(&mut inner, &key, &self.coordinator);
        }
        let index = inner.free.pop().unwrap_or_else(|| {
            inner.nodes.push(None);
            inner.nodes.len() - 1
        });
        let old_tail = inner.tail;
        inner.nodes[index] = Some(Node {
            key: key.clone(),
            value,
            weight,
            prev: old_tail,
            next: None,
        });
        if let Some(tail) = old_tail {
            inner.nodes[tail].as_mut().unwrap().next = Some(index);
        } else {
            inner.head = Some(index);
        }
        inner.tail = Some(index);
        inner.map.insert(key, index);
        inner.bytes += weight;
        self.coordinator.add(weight);
        inner.stats.admissions += 1;
        if replaced {
            inner.stats.replacements += 1;
        }
        while inner.bytes > self.policy.soft_limit_bytes
            || self
                .policy
                .max_entries
                .is_some_and(|max| inner.map.len() > max)
        {
            Self::evict_head(&mut inner, &self.coordinator);
        }
        if replaced {
            InsertOutcome::Replaced
        } else {
            InsertOutcome::Admitted
        }
    }

    pub fn remove(&self, key: &K) -> Option<Arc<V>> {
        Self::remove_key(&mut self.inner.lock().unwrap(), key, &self.coordinator)
    }
    pub fn clear(&self) {
        let mut inner = self.inner.lock().unwrap();
        let bytes = inner.bytes;
        inner.map.clear();
        inner.nodes.clear();
        inner.free.clear();
        inner.head = None;
        inner.tail = None;
        inner.bytes = 0;
        inner.stats.clears += 1;
        self.coordinator.subtract(bytes);
    }
    pub fn trim_to(&self, bytes: u64) {
        let mut inner = self.inner.lock().unwrap();
        while inner.bytes > bytes {
            Self::evict_head(&mut inner, &self.coordinator);
        }
    }
    pub fn retain(&self, mut keep: impl FnMut(&K, &Arc<V>) -> bool) {
        let keys: Vec<K> = {
            let inner = self.inner.lock().unwrap();
            inner
                .map
                .keys()
                .filter(|k| {
                    let i = inner.map[*k];
                    !keep(k, &inner.nodes[i].as_ref().unwrap().value)
                })
                .cloned()
                .collect()
        };
        for key in keys {
            self.remove(&key);
        }
    }
    pub fn stats(&self) -> CacheStats {
        let inner = self.inner.lock().unwrap();
        let mut stats = inner.stats.clone();
        stats.entries = inner.map.len();
        stats.bytes = inner.bytes;
        stats
    }

    fn touch(inner: &mut Inner<K, V>, index: usize) {
        if inner.tail == Some(index) {
            return;
        }
        let (prev, next) = {
            let n = inner.nodes[index].as_ref().unwrap();
            (n.prev, n.next)
        };
        if let Some(p) = prev {
            inner.nodes[p].as_mut().unwrap().next = next;
        } else {
            inner.head = next;
        }
        if let Some(n) = next {
            inner.nodes[n].as_mut().unwrap().prev = prev;
        }
        let tail = inner.tail;
        inner.nodes[index].as_mut().unwrap().prev = tail;
        inner.nodes[index].as_mut().unwrap().next = None;
        if let Some(t) = tail {
            inner.nodes[t].as_mut().unwrap().next = Some(index);
        }
        inner.tail = Some(index);
    }
    fn evict_head(inner: &mut Inner<K, V>, coordinator: &CacheBudgetCoordinator) {
        if let Some(index) = inner.head {
            let key = inner.nodes[index].as_ref().unwrap().key.clone();
            Self::remove_key(inner, &key, coordinator);
            inner.stats.evictions += 1;
        }
    }
    fn remove_key(
        inner: &mut Inner<K, V>,
        key: &K,
        coordinator: &CacheBudgetCoordinator,
    ) -> Option<Arc<V>> {
        let index = inner.map.remove(key)?;
        let node = inner.nodes[index].take().unwrap();
        if let Some(p) = node.prev {
            inner.nodes[p].as_mut().unwrap().next = node.next;
        } else {
            inner.head = node.next;
        }
        if let Some(n) = node.next {
            inner.nodes[n].as_mut().unwrap().prev = node.prev;
        } else {
            inner.tail = node.prev;
        }
        inner.bytes -= node.weight;
        coordinator.subtract(node.weight);
        inner.free.push(index);
        Some(node.value)
    }
}

impl<K: Eq + Hash + Clone, V: CacheWeight> MemoryLruCache<K, V> {
    pub fn insert_weighted(&self, key: K, value: Arc<V>) -> InsertOutcome {
        let weight = value.retained_bytes();
        self.insert(key, value, weight)
    }
}

impl<K, V> Drop for MemoryLruCache<K, V> {
    fn drop(&mut self) {
        if let Ok(inner) = self.inner.lock() {
            self.coordinator.subtract(inner.bytes);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cache(soft: u64, hard: u64) -> MemoryLruCache<u8, String> {
        MemoryLruCache::new(
            CachePolicy {
                name: "test",
                soft_limit_bytes: soft,
                hard_limit_bytes: hard,
                max_entries: None,
            },
            CacheBudgetCoordinator::new(1024, 2048),
        )
    }
    #[test]
    fn evicts_lru_by_weight() {
        let c = cache(8, 16);
        c.insert(1, Arc::new("one".into()), 4);
        c.insert(2, Arc::new("two".into()), 4);
        c.get(&1);
        c.insert(3, Arc::new("three".into()), 4);
        assert!(c.peek(&2).is_none());
        assert!(c.peek(&1).is_some());
    }
    #[test]
    fn replacement_is_accounted_exactly() {
        let c = cache(20, 20);
        c.insert(1, Arc::new("a".into()), 8);
        assert_eq!(
            c.insert(1, Arc::new("b".into()), 3),
            InsertOutcome::Replaced
        );
        assert_eq!(c.stats().bytes, 3);
    }
    #[test]
    fn oversized_value_is_returned_but_not_retained() {
        let c = cache(8, 10);
        assert_eq!(
            c.insert(1, Arc::new("large".into()), 11),
            InsertOutcome::RejectedOversized
        );
        assert!(c.peek(&1).is_none());
    }
    #[test]
    fn eviction_does_not_invalidate_in_flight_arcs() {
        let c = cache(4, 8);
        c.insert(1, Arc::new("held".into()), 4);
        let held = c.get(&1).unwrap();
        c.insert(2, Arc::new("new".into()), 4);
        c.insert(3, Arc::new("newer".into()), 4);
        assert_eq!(held.as_str(), "held");
        assert!(c.peek(&1).is_none());
    }

    #[test]
    fn failed_replacement_keeps_existing_value() {
        let coordinator = CacheBudgetCoordinator::new(8, 8);
        let first = MemoryLruCache::new(
            CachePolicy {
                name: "first",
                soft_limit_bytes: 8,
                hard_limit_bytes: 8,
                max_entries: None,
            },
            Arc::clone(&coordinator),
        );
        let second = MemoryLruCache::new(
            CachePolicy {
                name: "second",
                soft_limit_bytes: 8,
                hard_limit_bytes: 8,
                max_entries: None,
            },
            coordinator,
        );
        first.insert(1, Arc::new("existing"), 4);
        second.insert(2, Arc::new("other"), 4);
        assert_eq!(
            first.insert(1, Arc::new("too large"), 6),
            InsertOutcome::RejectedGlobalLimit
        );
        assert_eq!(*first.get(&1).unwrap(), "existing");
    }

    #[test]
    fn benchmark_weighted_lru_against_legacy_linear_vec() {
        use std::time::Instant;
        const ENTRIES: u32 = 4_096;
        const LOOKUPS: u32 = 200_000;
        let legacy: Vec<(u32, u64)> = (0..ENTRIES).map(|key| (key, 1024)).collect();
        let started = Instant::now();
        let mut checksum = 0u64;
        for key in 0..LOOKUPS {
            checksum ^= legacy
                .iter()
                .find(|entry| entry.0 == key % ENTRIES)
                .unwrap()
                .1;
        }
        let legacy_elapsed = started.elapsed();
        let cache = MemoryLruCache::new(
            CachePolicy {
                name: "bench",
                soft_limit_bytes: 8 * 1024 * 1024,
                hard_limit_bytes: 8 * 1024 * 1024,
                max_entries: None,
            },
            CacheBudgetCoordinator::new(8 * 1024 * 1024, 8 * 1024 * 1024),
        );
        for key in 0..ENTRIES {
            cache.insert(key, Arc::new(1024u64), 1024);
        }
        let started = Instant::now();
        for key in 0..LOOKUPS {
            checksum ^= *cache.get(&(key % ENTRIES)).unwrap();
        }
        let lru_elapsed = started.elapsed();
        eprintln!(
            "cache_benchmark lookups={LOOKUPS} legacy_vec_us={} weighted_lru_us={} retained_bytes={} checksum={checksum}",
            legacy_elapsed.as_micros(),
            lru_elapsed.as_micros(),
            cache.stats().bytes
        );
        assert!(lru_elapsed < legacy_elapsed);
    }
}
