use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CACHE_SCHEMA_VERSION: u32 = 1;
const SHADER_ABI_VERSION: u32 = 1;
const WGPU_VERSION: &str = "29.0.3";
const MAX_CACHE_BYTES: usize = 64 * 1024 * 1024;

const PIPELINE_MANIFEST: &[(&str, &str, &str, &str)] = &[
    (
        "main",
        concat!(
            include_str!("../shaders/generated_bindings.wgsl"),
            include_str!("../shaders/shader.wgsl")
        ),
        "main",
        "main-layout-v1",
    ),
    (
        "blur-horizontal",
        include_str!("../shaders/blur.wgsl"),
        "horizontal_blur",
        "blur-layout-v1",
    ),
    (
        "blur-vertical",
        include_str!("../shaders/blur.wgsl"),
        "vertical_blur",
        "blur-layout-v1",
    ),
    (
        "flare-threshold",
        include_str!("../shaders/flare.wgsl"),
        "threshold_main",
        "flare-threshold-layout-v1",
    ),
    (
        "flare-ghosts",
        include_str!("../shaders/flare.wgsl"),
        "ghosts_main",
        "flare-ghosts-layout-v1",
    ),
    (
        "display",
        include_str!("../shaders/display.wgsl"),
        "vs_main+fs_main",
        "display-layout-v1",
    ),
];

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineCacheIdentity {
    pub shader_manifest_sha256: String,
    pub shader_abi_version: u32,
    pub app_version: String,
    pub wgpu_version: String,
    pub backend: String,
    pub adapter_vendor: u32,
    pub adapter_device: u32,
    pub adapter_name_sha256: String,
    pub driver: String,
    pub driver_info_sha256: String,
    pub feature_bits: Vec<u64>,
    pub limits_sha256: String,
}

impl PipelineCacheIdentity {
    pub fn new(
        adapter_info: &wgpu::AdapterInfo,
        features: wgpu::Features,
        limits: &wgpu::Limits,
    ) -> Self {
        Self {
            shader_manifest_sha256: shader_manifest_sha256(),
            shader_abi_version: SHADER_ABI_VERSION,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            wgpu_version: WGPU_VERSION.to_string(),
            backend: format!("{:?}", adapter_info.backend),
            adapter_vendor: adapter_info.vendor,
            adapter_device: adapter_info.device,
            adapter_name_sha256: sha256_hex(adapter_info.name.as_bytes()),
            driver: adapter_info.driver.clone(),
            driver_info_sha256: sha256_hex(adapter_info.driver_info.as_bytes()),
            feature_bits: features.bits().0.to_vec(),
            limits_sha256: sha256_hex(format!("{limits:?}").as_bytes()),
        }
    }

    fn digest(&self) -> String {
        let encoded = serde_json::to_vec(self).expect("pipeline identity is serializable");
        sha256_hex(&encoded)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PipelineCacheMetadata {
    schema_version: u32,
    identity: PipelineCacheIdentity,
    artifact_sha256: String,
    artifact_bytes: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PipelineCacheStatus {
    Unsupported,
    Cold,
    Hit,
    Rejected,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PipelineWarmupStatus {
    Unrequested,
    Warming,
    Ready,
    FailedDegraded,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuPipelineReport {
    pub device_generation: u64,
    pub identity_sha256: String,
    pub backend: String,
    pub adapter_sha256: String,
    pub driver_sha256: String,
    pub cache_status: PipelineCacheStatus,
    pub cache_bytes_read: usize,
    pub cache_bytes_written: usize,
    pub rejection_reason: Option<String>,
    pub warmup_status: PipelineWarmupStatus,
    pub warmup_millis: Option<u64>,
    pub foreground_wait_millis: u64,
    pub core_pipeline_count: usize,
    pub optional_pipeline_count: usize,
    pub pipeline_creation_millis: BTreeMap<String, u64>,
}

struct RegistryState {
    report: GpuPipelineReport,
    warmup_started: Option<Instant>,
}

#[derive(Default)]
struct PersistenceState {
    in_flight: bool,
    dirty: bool,
}

impl PersistenceState {
    fn request(&mut self) -> bool {
        self.dirty = true;
        if self.in_flight {
            return false;
        }
        self.in_flight = true;
        true
    }

    fn take_pass(&mut self) -> bool {
        if self.dirty {
            self.dirty = false;
            true
        } else {
            self.in_flight = false;
            false
        }
    }
}

pub struct GpuPipelineRegistry {
    identity: PipelineCacheIdentity,
    cache_path: Option<PathBuf>,
    pipeline_cache: Option<wgpu::PipelineCache>,
    state: Mutex<RegistryState>,
    warmup_complete: Condvar,
    warmup_pipelines: Mutex<Vec<wgpu::ComputePipeline>>,
    persistence: Mutex<PersistenceState>,
}

impl GpuPipelineRegistry {
    pub fn new(
        device_generation: u64,
        device: &wgpu::Device,
        adapter_info: &wgpu::AdapterInfo,
        features: wgpu::Features,
        limits: &wgpu::Limits,
        cache_root: &Path,
    ) -> Arc<Self> {
        let identity = PipelineCacheIdentity::new(adapter_info, features, limits);
        let identity_sha256 = identity.digest();
        let backend_key = wgpu::util::pipeline_cache_key(adapter_info)
            .filter(|_| features.contains(wgpu::Features::PIPELINE_CACHE));
        let cache_mode = std::env::var("RAPIDRAW_GPU_PIPELINE_CACHE_MODE").unwrap_or_default();
        let cache_path = (cache_mode != "off")
            .then(|| backend_key.map(|_| cache_root.join(&identity_sha256)))
            .flatten();
        if cache_mode == "cold"
            && let Some(path) = &cache_path
        {
            let _ = fs::remove_dir_all(path);
        }
        if cache_path.is_some() {
            retain_recent_identities(cache_root, &identity_sha256, 3);
        }
        let mut status = if cache_path.is_some() {
            PipelineCacheStatus::Cold
        } else {
            PipelineCacheStatus::Unsupported
        };
        let mut bytes_read = 0;
        let mut rejection_reason = None;
        let initial_data =
            cache_path
                .as_deref()
                .and_then(|path| match load_validated_artifact(path, &identity) {
                    Ok(Some(data)) => {
                        status = PipelineCacheStatus::Hit;
                        bytes_read = data.len();
                        Some(data)
                    }
                    Ok(None) => None,
                    Err(reason) => {
                        status = PipelineCacheStatus::Rejected;
                        rejection_reason = Some(reason);
                        quarantine_cache(path);
                        None
                    }
                });
        let pipeline_cache = cache_path.as_ref().map(|_| {
            // SAFETY: bytes are accepted only when their separately stored identity matches the
            // complete adapter/driver/backend/features/limits/shader identity and their SHA-256
            // integrity digest matches. Rejected or missing bytes create an empty fallback cache.
            unsafe {
                device.create_pipeline_cache(&wgpu::PipelineCacheDescriptor {
                    label: Some("RapidRaw validated pipeline cache"),
                    data: initial_data.as_deref(),
                    fallback: true,
                })
            }
        });
        Arc::new(Self {
            identity: identity.clone(),
            cache_path,
            pipeline_cache,
            state: Mutex::new(RegistryState {
                report: GpuPipelineReport {
                    device_generation,
                    identity_sha256,
                    backend: identity.backend,
                    adapter_sha256: identity.adapter_name_sha256,
                    driver_sha256: identity.driver_info_sha256,
                    cache_status: status,
                    cache_bytes_read: bytes_read,
                    cache_bytes_written: 0,
                    rejection_reason,
                    warmup_status: PipelineWarmupStatus::Unrequested,
                    warmup_millis: None,
                    foreground_wait_millis: 0,
                    core_pipeline_count: if cfg!(target_os = "windows") { 4 } else { 3 },
                    optional_pipeline_count: 2,
                    pipeline_creation_millis: BTreeMap::new(),
                },
                warmup_started: None,
            }),
            warmup_complete: Condvar::new(),
            warmup_pipelines: Mutex::new(Vec::new()),
            persistence: Mutex::new(PersistenceState::default()),
        })
    }

    pub fn pipeline_cache(&self) -> Option<&wgpu::PipelineCache> {
        self.pipeline_cache.as_ref()
    }

    pub fn begin_warmup(&self) -> bool {
        let mut state = self.state.lock().unwrap();
        if state.report.warmup_status != PipelineWarmupStatus::Unrequested {
            return false;
        }
        state.report.warmup_status = PipelineWarmupStatus::Warming;
        state.warmup_started = Some(Instant::now());
        true
    }

    pub fn start_core_warmup_async(self: &Arc<Self>, device: Arc<wgpu::Device>) {
        if !self.begin_warmup() {
            return;
        }
        let registry = Arc::clone(self);
        std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let cache = registry.pipeline_cache();
                let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("Warmup image processing shader"),
                    source: wgpu::ShaderSource::Wgsl(
                        concat!(
                            include_str!("../shaders/generated_bindings.wgsl"),
                            include_str!("../shaders/shader.wgsl")
                        )
                        .into(),
                    ),
                });
                let blur = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("Warmup blur shader"),
                    source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/blur.wgsl").into()),
                });
                let descriptors = [
                    ("Warmup main pipeline", &shader, "main"),
                    ("Warmup horizontal blur", &blur, "horizontal_blur"),
                    ("Warmup vertical blur", &blur, "vertical_blur"),
                ];
                let mut pipelines = Vec::with_capacity(descriptors.len());
                for (label, module, entry_point) in descriptors {
                    let started = Instant::now();
                    pipelines.push(device.create_compute_pipeline(
                        &wgpu::ComputePipelineDescriptor {
                            label: Some(label),
                            layout: None,
                            module,
                            entry_point: Some(entry_point),
                            compilation_options: Default::default(),
                            cache,
                        },
                    ));
                    registry.record_pipeline_creation(label, started.elapsed());
                }
                *registry.warmup_pipelines.lock().unwrap() = pipelines;
            }))
            .map_err(|_| "core pipeline warmup panicked; using demand compilation".to_string());
            registry.finish_warmup(result, Duration::ZERO);
        });
    }

    pub fn wait_for_core_warmup(&self) -> Duration {
        let started = Instant::now();
        let mut state = self.state.lock().unwrap();
        while state.report.warmup_status == PipelineWarmupStatus::Warming {
            state = self.warmup_complete.wait(state).unwrap();
        }
        let waited = started.elapsed();
        state.report.foreground_wait_millis = state
            .report
            .foreground_wait_millis
            .saturating_add(waited.as_millis() as u64);
        waited
    }

    pub fn finish_warmup(self: &Arc<Self>, result: Result<(), String>, foreground_wait: Duration) {
        let mut state = self.state.lock().unwrap();
        state.report.foreground_wait_millis = state
            .report
            .foreground_wait_millis
            .saturating_add(foreground_wait.as_millis() as u64);
        state.report.warmup_millis = state
            .warmup_started
            .take()
            .map(|started| started.elapsed().as_millis() as u64);
        match result {
            Ok(()) => state.report.warmup_status = PipelineWarmupStatus::Ready,
            Err(error) => {
                state.report.warmup_status = PipelineWarmupStatus::FailedDegraded;
                state.report.rejection_reason = Some(error);
            }
        }
        drop(state);
        self.warmup_complete.notify_all();
    }

    pub fn report(&self) -> GpuPipelineReport {
        self.state.lock().unwrap().report.clone()
    }

    pub fn record_pipeline_creation(&self, label: &str, duration: Duration) {
        self.state
            .lock()
            .unwrap()
            .report
            .pipeline_creation_millis
            .insert(label.to_string(), duration.as_millis() as u64);
    }

    pub fn persist_after_pipeline_update(self: &Arc<Self>) {
        if !self.persistence.lock().unwrap().request() {
            return;
        }
        let Some(cache) = self.pipeline_cache.clone() else {
            *self.persistence.lock().unwrap() = PersistenceState::default();
            return;
        };
        let Some(path) = self.cache_path.clone() else {
            *self.persistence.lock().unwrap() = PersistenceState::default();
            return;
        };
        let identity = self.identity.clone();
        let registry = Arc::clone(self);
        std::thread::spawn(move || {
            while registry.persistence.lock().unwrap().take_pass() {
                let Some(data) = cache.get_data() else {
                    continue;
                };
                match persist_artifact(&path, &identity, &data) {
                    Ok(()) => {
                        registry.state.lock().unwrap().report.cache_bytes_written = data.len()
                    }
                    Err(error) => {
                        registry.state.lock().unwrap().report.rejection_reason = Some(error)
                    }
                }
            }
        });
    }
}

fn shader_manifest_sha256() -> String {
    pipeline_manifest_sha256(PIPELINE_MANIFEST)
}

fn pipeline_manifest_sha256(manifest: &[(&str, &str, &str, &str)]) -> String {
    let mut hasher = Sha256::new();
    for (name, source, entry, layout) in manifest {
        for part in [
            name.as_bytes(),
            source.as_bytes(),
            entry.as_bytes(),
            layout.as_bytes(),
        ] {
            hasher.update((part.len() as u64).to_le_bytes());
            hasher.update(part);
        }
    }
    hex::encode(hasher.finalize())
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn load_validated_artifact(
    directory: &Path,
    identity: &PipelineCacheIdentity,
) -> Result<Option<Vec<u8>>, String> {
    let metadata_path = directory.join("metadata.json");
    let artifact_path = directory.join("pipeline.bin");
    if !metadata_path.exists() && !artifact_path.exists() {
        return Ok(None);
    }
    let metadata_bytes = fs::read(&metadata_path).map_err(|error| error.to_string())?;
    let metadata: PipelineCacheMetadata =
        serde_json::from_slice(&metadata_bytes).map_err(|error| error.to_string())?;
    if metadata.schema_version != CACHE_SCHEMA_VERSION || metadata.identity != *identity {
        return Err("pipeline cache identity mismatch".to_string());
    }
    if metadata.artifact_bytes > MAX_CACHE_BYTES {
        return Err("pipeline cache exceeds size limit".to_string());
    }
    let artifact = fs::read(&artifact_path).map_err(|error| error.to_string())?;
    if artifact.len() != metadata.artifact_bytes
        || sha256_hex(&artifact) != metadata.artifact_sha256
    {
        return Err("pipeline cache integrity mismatch".to_string());
    }
    Ok(Some(artifact))
}

fn persist_artifact(
    directory: &Path,
    identity: &PipelineCacheIdentity,
    artifact: &[u8],
) -> Result<(), String> {
    if artifact.len() > MAX_CACHE_BYTES {
        return Err("pipeline cache exceeds size limit".to_string());
    }
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let metadata = PipelineCacheMetadata {
        schema_version: CACHE_SCHEMA_VERSION,
        identity: identity.clone(),
        artifact_sha256: sha256_hex(artifact),
        artifact_bytes: artifact.len(),
    };
    atomic_write(&directory.join("pipeline.bin"), artifact)?;
    let encoded = serde_json::to_vec(&metadata).map_err(|error| error.to_string())?;
    atomic_write(&directory.join("metadata.json"), &encoded)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = path.with_extension(format!("tmp-{}-{nonce}", std::process::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn quarantine_cache(path: &Path) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let _ = fs::rename(path, path.with_extension(format!("invalid-{timestamp}")));
}

fn retain_recent_identities(root: &Path, current: &str, retain: usize) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut directories: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let metadata = entry.metadata().ok()?;
            (metadata.is_dir() && name != current)
                .then_some((metadata.modified().unwrap_or(UNIX_EPOCH), entry.path()))
        })
        .collect();
    directories.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    for (_, path) in directories.into_iter().skip(retain.saturating_sub(1)) {
        let _ = fs::remove_dir_all(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry_without_device() -> Arc<GpuPipelineRegistry> {
        let identity = identity("shader-a");
        Arc::new(GpuPipelineRegistry {
            cache_path: None,
            pipeline_cache: None,
            state: Mutex::new(RegistryState {
                report: GpuPipelineReport {
                    device_generation: 7,
                    identity_sha256: identity.digest(),
                    backend: identity.backend.clone(),
                    adapter_sha256: identity.adapter_name_sha256.clone(),
                    driver_sha256: identity.driver_info_sha256.clone(),
                    cache_status: PipelineCacheStatus::Unsupported,
                    cache_bytes_read: 0,
                    cache_bytes_written: 0,
                    rejection_reason: None,
                    warmup_status: PipelineWarmupStatus::Unrequested,
                    warmup_millis: None,
                    foreground_wait_millis: 0,
                    core_pipeline_count: 3,
                    optional_pipeline_count: 2,
                    pipeline_creation_millis: BTreeMap::new(),
                },
                warmup_started: None,
            }),
            identity,
            warmup_complete: Condvar::new(),
            warmup_pipelines: Mutex::new(Vec::new()),
            persistence: Mutex::new(PersistenceState::default()),
        })
    }

    fn identity(seed: &str) -> PipelineCacheIdentity {
        PipelineCacheIdentity {
            shader_manifest_sha256: sha256_hex(seed.as_bytes()),
            shader_abi_version: SHADER_ABI_VERSION,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            wgpu_version: WGPU_VERSION.to_string(),
            backend: "Vulkan".to_string(),
            adapter_vendor: 1,
            adapter_device: 2,
            adapter_name_sha256: sha256_hex(b"adapter"),
            driver: "driver".to_string(),
            driver_info_sha256: sha256_hex(b"driver-info"),
            feature_bits: vec![3],
            limits_sha256: sha256_hex(b"limits"),
        }
    }

    #[test]
    fn identity_and_integrity_gate_cache_reuse() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cache");
        let expected = identity("shader-a");
        persist_artifact(&path, &expected, b"opaque-cache").unwrap();
        assert_eq!(
            load_validated_artifact(&path, &expected).unwrap(),
            Some(b"opaque-cache".to_vec())
        );
        assert!(load_validated_artifact(&path, &identity("shader-b")).is_err());
        fs::write(path.join("pipeline.bin"), b"corrupt").unwrap();
        assert!(load_validated_artifact(&path, &expected).is_err());
    }

    #[test]
    fn film_stage_keeps_luminance_and_color_bindings_distinct() {
        let shader = include_str!("../shaders/shader.wgsl");
        assert!(shader.contains("let shaped_luminance = luminance * (1.0 + shaper_p)"));
        assert!(shader.contains("let shaped_color = color_in + (color_in * scale - color_in)"));
        assert!(!shader.contains("let shaped = color_in + (color_in * scale - color_in)"));
    }

    #[test]
    fn cache_artifact_rewrite_is_atomic_and_latest_pair_is_valid() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cache");
        let expected = identity("shader-a");
        persist_artifact(&path, &expected, b"first-cache").unwrap();
        persist_artifact(&path, &expected, b"expanded-cache").unwrap();

        assert_eq!(
            load_validated_artifact(&path, &expected).unwrap(),
            Some(b"expanded-cache".to_vec())
        );
        assert!(fs::read_dir(&path).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("tmp-")
        }));
    }

    #[test]
    fn failed_atomic_publish_removes_its_temporary_artifact() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("occupied");
        fs::create_dir(&target).unwrap();
        assert!(atomic_write(&target, b"cache").is_err());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn oversized_metadata_is_rejected_before_artifact_allocation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cache");
        fs::create_dir(&path).unwrap();
        let expected = identity("shader-a");
        let metadata = PipelineCacheMetadata {
            schema_version: CACHE_SCHEMA_VERSION,
            identity: expected.clone(),
            artifact_sha256: sha256_hex(b"unused"),
            artifact_bytes: MAX_CACHE_BYTES + 1,
        };
        fs::write(
            path.join("metadata.json"),
            serde_json::to_vec(&metadata).unwrap(),
        )
        .unwrap();

        assert_eq!(
            load_validated_artifact(&path, &expected).unwrap_err(),
            "pipeline cache exceeds size limit"
        );
    }

    #[test]
    fn every_runtime_identity_dimension_invalidates_reuse() {
        let base = identity("shader-a");
        let mut variants = Vec::new();
        let mut value = base.clone();
        value.shader_abi_version += 1;
        variants.push(value);
        let mut value = base.clone();
        value.app_version.push_str("-next");
        variants.push(value);
        let mut value = base.clone();
        value.wgpu_version.push_str("-next");
        variants.push(value);
        let mut value = base.clone();
        value.backend = "Metal".to_string();
        variants.push(value);
        let mut value = base.clone();
        value.adapter_vendor += 1;
        variants.push(value);
        let mut value = base.clone();
        value.adapter_device += 1;
        variants.push(value);
        let mut value = base.clone();
        value.adapter_name_sha256 = sha256_hex(b"other-adapter");
        variants.push(value);
        let mut value = base.clone();
        value.driver.push_str("-next");
        variants.push(value);
        let mut value = base.clone();
        value.driver_info_sha256 = sha256_hex(b"other-driver");
        variants.push(value);
        let mut value = base.clone();
        value.feature_bits.push(4);
        variants.push(value);
        let mut value = base.clone();
        value.limits_sha256 = sha256_hex(b"other-limits");
        variants.push(value);
        assert!(
            variants
                .iter()
                .all(|variant| variant.digest() != base.digest())
        );
    }

    #[test]
    fn cache_paths_expose_only_identity_digest() {
        let value = identity("private adapter name");
        let digest = value.digest();
        assert_eq!(digest.len(), 64);
        assert!(!digest.contains("adapter"));
        assert!(!digest.contains("driver"));
    }

    #[test]
    fn shader_manifest_covers_every_current_pipeline_entry() {
        let entries: Vec<_> = PIPELINE_MANIFEST.iter().map(|entry| entry.2).collect();
        assert_eq!(
            entries,
            vec![
                "main",
                "horizontal_blur",
                "vertical_blur",
                "threshold_main",
                "ghosts_main",
                "vs_main+fs_main",
            ]
        );
        assert_eq!(shader_manifest_sha256().len(), 64);
    }

    #[test]
    fn shader_source_entry_and_layout_each_change_manifest_identity() {
        let baseline = [("pipeline", "source-a", "entry-a", "layout-a")];
        let variants = [
            [("pipeline", "source-b", "entry-a", "layout-a")],
            [("pipeline", "source-a", "entry-b", "layout-a")],
            [("pipeline", "source-a", "entry-a", "layout-b")],
        ];
        let baseline_digest = pipeline_manifest_sha256(&baseline);
        assert!(
            variants
                .iter()
                .all(|variant| pipeline_manifest_sha256(variant) != baseline_digest)
        );
    }

    #[test]
    fn identity_retention_is_bounded_without_removing_current() {
        let root = tempfile::tempdir().unwrap();
        for name in ["old-a", "old-b", "old-c", "current"] {
            fs::create_dir(root.path().join(name)).unwrap();
        }
        retain_recent_identities(root.path(), "current", 3);
        assert!(root.path().join("current").is_dir());
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 3);
    }

    #[test]
    fn persistence_requests_during_a_write_schedule_another_pass() {
        let mut state = PersistenceState::default();
        assert!(state.request());
        assert!(state.take_pass());
        assert!(!state.request());
        assert!(state.take_pass());
        assert!(!state.take_pass());
        assert!(!state.in_flight);
    }

    #[test]
    fn concurrent_warmup_callers_join_one_owner_and_failure_degrades() {
        let registry = registry_without_device();
        assert!(registry.begin_warmup());
        assert!(!registry.begin_warmup());
        let waiter_registry = Arc::clone(&registry);
        let (finished_tx, finished_rx) = std::sync::mpsc::channel();
        let waiter = std::thread::spawn(move || {
            waiter_registry.wait_for_core_warmup();
            finished_tx.send(()).unwrap();
        });
        assert!(finished_rx.recv_timeout(Duration::from_millis(20)).is_err());
        registry.finish_warmup(Err("compile failed".to_string()), Duration::ZERO);
        finished_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        waiter.join().unwrap();
        let report = registry.report();
        assert_eq!(report.warmup_status, PipelineWarmupStatus::FailedDegraded);
        assert_eq!(report.rejection_reason.as_deref(), Some("compile failed"));
    }
}
