use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::http;

pub const ANALYTICS_PROTOCOL: &str = "rapidraw-analytics";
const MAX_CACHE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsResourceDescriptor {
    pub resource_id: String,
    pub mime_type: String,
    pub byte_len: u64,
    pub url: String,
}

struct Entry {
    bytes: Vec<u8>,
    mime: &'static str,
}
#[derive(Default)]
struct Cache {
    entries: HashMap<String, Entry>,
    order: VecDeque<String>,
    bytes: usize,
}
static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();

pub fn publish(bytes: Vec<u8>, mime: &'static str, identity: &[u8]) -> AnalyticsResourceDescriptor {
    let mut hash = blake3::Hasher::new();
    hash.update(identity);
    hash.update(&bytes);
    let id = hash.finalize().to_hex().to_string();
    let len = bytes.len();
    let mut cache = CACHE.get_or_init(Default::default).lock().unwrap();
    if !cache.entries.contains_key(&id) {
        while cache.bytes + len > MAX_CACHE_BYTES {
            let Some(old) = cache.order.pop_front() else {
                break;
            };
            if let Some(entry) = cache.entries.remove(&old) {
                cache.bytes -= entry.bytes.len();
            }
        }
        if len <= MAX_CACHE_BYTES {
            cache.bytes += len;
            cache.order.push_back(id.clone());
            cache.entries.insert(id.clone(), Entry { bytes, mime });
        }
    }
    let origin = if cfg!(target_os = "windows") {
        "http://rapidraw-analytics.localhost"
    } else {
        "rapidraw-analytics://localhost"
    };
    AnalyticsResourceDescriptor {
        resource_id: id.clone(),
        mime_type: mime.into(),
        byte_len: len as u64,
        url: format!("{origin}/{id}"),
    }
}

pub fn protocol_response(uri: &http::Uri) -> http::Response<Vec<u8>> {
    let id = uri.path().trim_matches('/');
    let found = id.len() == 64
        && id.bytes().all(|b| b.is_ascii_hexdigit())
        && CACHE
            .get_or_init(Default::default)
            .lock()
            .unwrap()
            .entries
            .contains_key(id);
    if !found {
        return http::Response::builder()
            .status(404)
            .body(Vec::new())
            .unwrap();
    }
    let cache = CACHE.get_or_init(Default::default).lock().unwrap();
    let entry = &cache.entries[id];
    http::Response::builder()
        .status(200)
        .header(http::header::CONTENT_TYPE, entry.mime)
        .header(http::header::CACHE_CONTROL, "public, max-age=60")
        .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(entry.bytes.clone())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_untrusted_resource_paths() {
        let response =
            protocol_response(&"rapidraw-analytics://localhost/../secret".parse().unwrap());
        assert_eq!(response.status(), 404);
    }
}
