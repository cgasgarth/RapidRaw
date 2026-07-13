use image::{DynamicImage, ImageBuffer, Rgb32FImage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::UNIX_EPOCH;

const ARTIFACT_VERSION: u32 = 1;
const IMPLEMENTATION_VERSION: u32 = 2;
const DEFAULT_MEMORY_BUDGET_BYTES: u64 = 512 * 1024 * 1024;
const DEFAULT_DISK_BUDGET_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const NIND_MODEL_SHA256: &str = "ee3586279d514df557ff3f7dec6df37fafc51ba5d3a3435b2cc9ac2d9017e7fe";

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalSourceRevision {
    pub canonical_path: String,
    pub byte_length: u64,
    pub modified_ns: u128,
}

impl PhysicalSourceRevision {
    pub fn from_path(path: &Path) -> Result<Self, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("denoise_source_canonicalize_failed:{error}"))?;
        let metadata = canonical
            .metadata()
            .map_err(|error| format!("denoise_source_metadata_failed:{error}"))?;
        let modified_ns = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        Ok(Self {
            canonical_path: canonical.to_string_lossy().into_owned(),
            byte_length: metadata.len(),
            modified_ns,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedDenoisePlanV1 {
    pub source_revision: PhysicalSourceRevision,
    pub source_class: String,
    pub decode_fingerprint: String,
    pub noise_profile_fingerprint: String,
    pub algorithm_id: String,
    pub legacy_method_token: Option<String>,
    pub model_content_hash: Option<String>,
    pub quality: String,
    pub impact: f32,
    pub natural_grain: f32,
    pub tile_policy: String,
    pub stage_placement: String,
    pub input_domain: String,
    pub output_domain: String,
    pub intensity: f32,
    pub implementation_version: u32,
}

impl EnhancedDenoisePlanV1 {
    pub fn legacy_adapter(
        source_path: &Path,
        method: &str,
        intensity: f32,
    ) -> Result<Self, String> {
        if !intensity.is_finite() || !(0.0..=1.0).contains(&intensity) {
            return Err("denoise_intensity_out_of_range".to_string());
        }
        let source_revision = PhysicalSourceRevision::from_path(source_path)?;
        let source_class = if crate::formats::is_raw_file(&source_revision.canonical_path) {
            if source_path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("raf"))
            {
                "x_trans_raw_post_demosaic"
            } else {
                "raw_post_demosaic"
            }
        } else {
            "encoded_rgb"
        };
        let algorithm_id = match method {
            "ai" => "nind_rgb_raised_cosine_tiled_v2",
            "bm3d" => "legacy_collaborative_transform_filter_v1",
            _ => return Err(format!("denoise_method_unsupported:{method}")),
        };
        let decode_fingerprint = fingerprint_json(&serde_json::json!({
            "source": source_revision,
            "decode": "rapidraw_default_raw_or_rgb_v1",
        }))?;
        let noise_profile_fingerprint = fingerprint_json(&serde_json::json!({
            "decodeFingerprint": decode_fingerprint,
            "analysis": "noise_profile_plan_v1",
        }))?;
        Ok(Self {
            source_revision,
            source_class: source_class.to_string(),
            decode_fingerprint,
            noise_profile_fingerprint,
            algorithm_id: algorithm_id.to_string(),
            legacy_method_token: Some(method.to_string()),
            model_content_hash: (method == "ai").then(|| format!("sha256:{NIND_MODEL_SHA256}")),
            quality: "enhanced".to_string(),
            impact: 1.0,
            natural_grain: 0.0,
            tile_policy: if method == "ai" {
                "mirror_pad_504px_raised_cosine_normalized_v2"
            } else {
                "full_frame_collaborative_v1"
            }
            .to_string(),
            stage_placement: "post_demosaic_pre_creative_tone".to_string(),
            input_domain: "bounded_rgb_model_plus_scene_linear_residual".to_string(),
            output_domain: "scene_linear_rgb_f32".to_string(),
            intensity,
            implementation_version: IMPLEMENTATION_VERSION,
        })
    }

    pub fn fingerprint(&self) -> Result<String, String> {
        fingerprint_json(self)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DenoiseQualityReceiptV1 {
    pub input_over_range_count: u64,
    pub input_negative_count: u64,
    pub output_over_range_count: u64,
    pub output_negative_count: u64,
    pub finite_output: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SceneRangeCounts {
    pub over_range: u64,
    pub negative: u64,
}

impl SceneRangeCounts {
    pub fn measure(image: &Rgb32FImage) -> Self {
        let mut over_range = 0;
        let mut negative = 0;
        for value in image.as_raw() {
            over_range += u64::from(*value > 1.0);
            negative += u64::from(*value < 0.0);
        }
        Self {
            over_range,
            negative,
        }
    }
}

pub struct EnhancedDenoiseBuildOutput {
    pub image: DynamicImage,
    pub input_range: SceneRangeCounts,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedDenoiseArtifactManifestV1 {
    pub artifact_version: u32,
    pub artifact_id: String,
    pub plan_fingerprint: String,
    pub plan: EnhancedDenoisePlanV1,
    pub dimensions: [u32; 2],
    pub channels: u8,
    pub precision: String,
    pub pixel_content_hash: String,
    pub pixel_byte_length: u64,
    pub quality_receipt: DenoiseQualityReceiptV1,
}

#[derive(Clone)]
pub struct EnhancedDenoiseArtifactV1 {
    pub manifest: EnhancedDenoiseArtifactManifestV1,
    pub image: Arc<DynamicImage>,
}

impl EnhancedDenoiseArtifactV1 {
    fn retained_bytes(&self) -> u64 {
        self.manifest.pixel_byte_length
    }
}

struct ArtifactFlight {
    result: Mutex<Option<Result<Arc<EnhancedDenoiseArtifactV1>, String>>>,
    ready: Condvar,
}

impl ArtifactFlight {
    fn new() -> Self {
        Self {
            result: Mutex::new(None),
            ready: Condvar::new(),
        }
    }
}

#[derive(Default)]
struct MemoryArtifacts {
    entries: HashMap<String, Arc<EnhancedDenoiseArtifactV1>>,
    lru: VecDeque<String>,
    bytes: u64,
}

pub struct EnhancedDenoiseArtifactStore {
    memory: Mutex<MemoryArtifacts>,
    flights: Mutex<HashMap<String, Arc<ArtifactFlight>>>,
    memory_budget_bytes: u64,
    disk_budget_bytes: u64,
}

impl Default for EnhancedDenoiseArtifactStore {
    fn default() -> Self {
        Self::new(DEFAULT_MEMORY_BUDGET_BYTES)
    }
}

impl EnhancedDenoiseArtifactStore {
    pub fn new(memory_budget_bytes: u64) -> Self {
        Self::with_budgets(memory_budget_bytes, DEFAULT_DISK_BUDGET_BYTES)
    }

    pub fn with_budgets(memory_budget_bytes: u64, disk_budget_bytes: u64) -> Self {
        Self {
            memory: Mutex::new(MemoryArtifacts::default()),
            flights: Mutex::new(HashMap::new()),
            memory_budget_bytes,
            disk_budget_bytes,
        }
    }

    pub fn get(&self, fingerprint: &str) -> Option<Arc<EnhancedDenoiseArtifactV1>> {
        let mut memory = self.memory.lock().unwrap();
        let artifact = Arc::clone(memory.entries.get(fingerprint)?);
        touch_lru(&mut memory.lru, fingerprint);
        Some(artifact)
    }

    pub fn get_or_build<F>(
        &self,
        cache_root: &Path,
        plan: EnhancedDenoisePlanV1,
        build: F,
    ) -> Result<Arc<EnhancedDenoiseArtifactV1>, String>
    where
        F: FnOnce() -> Result<EnhancedDenoiseBuildOutput, String>,
    {
        let fingerprint = plan.fingerprint()?;
        if let Some(artifact) = self.get(&fingerprint) {
            return Ok(artifact);
        }

        let (flight, leader) = {
            let mut flights = self.flights.lock().unwrap();
            if let Some(existing) = flights.get(&fingerprint) {
                (Arc::clone(existing), false)
            } else {
                let flight = Arc::new(ArtifactFlight::new());
                flights.insert(fingerprint.clone(), Arc::clone(&flight));
                (flight, true)
            }
        };

        if !leader {
            let mut result = flight.result.lock().unwrap();
            while result.is_none() {
                result = flight.ready.wait(result).unwrap();
            }
            return result.as_ref().unwrap().clone();
        }

        let result = self
            .load_verified(cache_root, &fingerprint, &plan)
            .or_else(|_| {
                let output = build()?;
                self.publish(cache_root, plan, &fingerprint, output)
            })
            .map(Arc::new);

        if let Ok(artifact) = &result {
            self.admit(fingerprint.clone(), Arc::clone(artifact));
        }
        *flight.result.lock().unwrap() = Some(result.clone());
        flight.ready.notify_all();
        self.flights.lock().unwrap().remove(&fingerprint);
        result
    }

    fn admit(&self, fingerprint: String, artifact: Arc<EnhancedDenoiseArtifactV1>) {
        let weight = artifact.retained_bytes();
        if weight > self.memory_budget_bytes {
            return;
        }
        let mut memory = self.memory.lock().unwrap();
        if let Some(previous) = memory.entries.remove(&fingerprint) {
            memory.bytes = memory.bytes.saturating_sub(previous.retained_bytes());
        }
        touch_lru(&mut memory.lru, &fingerprint);
        memory.bytes = memory.bytes.saturating_add(weight);
        memory.entries.insert(fingerprint, artifact);
        while memory.bytes > self.memory_budget_bytes {
            let Some(oldest) = memory.lru.pop_front() else {
                break;
            };
            if let Some(removed) = memory.entries.remove(&oldest) {
                memory.bytes = memory.bytes.saturating_sub(removed.retained_bytes());
            }
        }
    }

    fn publish(
        &self,
        cache_root: &Path,
        plan: EnhancedDenoisePlanV1,
        fingerprint: &str,
        output: EnhancedDenoiseBuildOutput,
    ) -> Result<EnhancedDenoiseArtifactV1, String> {
        fs::create_dir_all(cache_root)
            .map_err(|error| format!("denoise_cache_create_failed:{error}"))?;
        let rgb = output.image.to_rgb32f();
        let pixels = encode_f32_pixels(&rgb);
        let pixel_hash = sha256(&pixels);
        let artifact_id = format!("denoise:{fingerprint}");
        let manifest = EnhancedDenoiseArtifactManifestV1 {
            artifact_version: ARTIFACT_VERSION,
            artifact_id,
            plan_fingerprint: fingerprint.to_string(),
            plan,
            dimensions: [rgb.width(), rgb.height()],
            channels: 3,
            precision: "rgb_f32_le".to_string(),
            pixel_content_hash: pixel_hash,
            pixel_byte_length: pixels.len() as u64,
            quality_receipt: quality_receipt(&rgb, output.input_range),
        };
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("denoise_manifest_serialize_failed:{error}"))?;
        let (pixel_path, manifest_path) = artifact_paths(cache_root, fingerprint);
        atomic_write(&pixel_path, &pixels)?;
        if let Err(error) = atomic_write(&manifest_path, &manifest_bytes) {
            let _ = fs::remove_file(&pixel_path);
            return Err(error);
        }
        let _ = enforce_disk_budget(cache_root, self.disk_budget_bytes, fingerprint);
        Ok(EnhancedDenoiseArtifactV1 {
            manifest,
            image: Arc::new(DynamicImage::ImageRgb32F(rgb)),
        })
    }

    fn load_verified(
        &self,
        cache_root: &Path,
        fingerprint: &str,
        expected_plan: &EnhancedDenoisePlanV1,
    ) -> Result<EnhancedDenoiseArtifactV1, String> {
        let (pixel_path, manifest_path) = artifact_paths(cache_root, fingerprint);
        let result = (|| {
            let manifest_bytes = fs::read(&manifest_path)
                .map_err(|error| format!("denoise_manifest_read_failed:{error}"))?;
            let manifest: EnhancedDenoiseArtifactManifestV1 =
                serde_json::from_slice(&manifest_bytes)
                    .map_err(|error| format!("denoise_manifest_invalid:{error}"))?;
            if manifest.artifact_version != ARTIFACT_VERSION
                || manifest.plan_fingerprint != fingerprint
                || manifest.plan != *expected_plan
                || manifest.channels != 3
                || manifest.precision != "rgb_f32_le"
            {
                return Err("denoise_manifest_identity_mismatch".to_string());
            }
            let pixels = fs::read(&pixel_path)
                .map_err(|error| format!("denoise_pixels_read_failed:{error}"))?;
            if pixels.len() as u64 != manifest.pixel_byte_length
                || sha256(&pixels) != manifest.pixel_content_hash
            {
                return Err("denoise_artifact_content_mismatch".to_string());
            }
            let rgb = decode_f32_pixels(&pixels, manifest.dimensions)?;
            Ok(EnhancedDenoiseArtifactV1 {
                manifest,
                image: Arc::new(DynamicImage::ImageRgb32F(rgb)),
            })
        })();
        if result.is_err() && (manifest_path.exists() || pixel_path.exists()) {
            quarantine_pair(&manifest_path, &pixel_path);
        }
        result
    }
}

fn fingerprint_json(value: &impl Serialize) -> Result<String, String> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| format!("denoise_fingerprint_serialize_failed:{error}"))?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn encode_f32_pixels(image: &Rgb32FImage) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(image.as_raw().len() * 4);
    for value in image.as_raw() {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn decode_f32_pixels(bytes: &[u8], dimensions: [u32; 2]) -> Result<Rgb32FImage, String> {
    let expected = dimensions[0] as usize * dimensions[1] as usize * 3 * 4;
    if bytes.len() != expected {
        return Err("denoise_artifact_dimensions_mismatch".to_string());
    }
    let values = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();
    ImageBuffer::from_raw(dimensions[0], dimensions[1], values)
        .ok_or_else(|| "denoise_artifact_decode_failed".to_string())
}

fn quality_receipt(image: &Rgb32FImage, input: SceneRangeCounts) -> DenoiseQualityReceiptV1 {
    let mut output_over_range_count = 0;
    let mut output_negative_count = 0;
    let mut finite_output = true;
    for value in image.as_raw() {
        output_over_range_count += u64::from(*value > 1.0);
        output_negative_count += u64::from(*value < 0.0);
        finite_output &= value.is_finite();
    }
    DenoiseQualityReceiptV1 {
        input_over_range_count: input.over_range,
        input_negative_count: input.negative,
        output_over_range_count,
        output_negative_count,
        finite_output,
    }
}

fn artifact_paths(root: &Path, fingerprint: &str) -> (PathBuf, PathBuf) {
    (
        root.join(format!("{fingerprint}.rgbf32")),
        root.join(format!("{fingerprint}.json")),
    )
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension(format!(
        "{}.tmp-{}",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("bin"),
        std::process::id()
    ));
    fs::write(&temp_path, bytes)
        .map_err(|error| format!("denoise_artifact_temp_write_failed:{error}"))?;
    fs::rename(&temp_path, path).map_err(|error| format!("denoise_artifact_publish_failed:{error}"))
}

fn quarantine_pair(manifest: &Path, pixels: &Path) {
    for path in [manifest, pixels] {
        if path.exists() {
            let quarantine = path.with_extension(format!(
                "{}.quarantine",
                path.extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("artifact")
            ));
            let _ = fs::remove_file(&quarantine);
            let _ = fs::rename(path, quarantine);
        }
    }
}

fn touch_lru(lru: &mut VecDeque<String>, fingerprint: &str) {
    if let Some(index) = lru.iter().position(|value| value == fingerprint) {
        lru.remove(index);
    }
    lru.push_back(fingerprint.to_string());
}

fn enforce_disk_budget(root: &Path, budget_bytes: u64, protected: &str) -> Result<(), String> {
    let mut artifacts = Vec::new();
    let mut total = 0u64;
    for entry in fs::read_dir(root).map_err(|error| format!("denoise_cache_scan_failed:{error}"))? {
        let path = entry
            .map_err(|error| format!("denoise_cache_entry_failed:{error}"))?
            .path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some(fingerprint) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        let (pixels, manifest) = artifact_paths(root, fingerprint);
        let manifest_bytes = manifest.metadata().map(|value| value.len()).unwrap_or(0);
        let pixel_bytes = pixels.metadata().map(|value| value.len()).unwrap_or(0);
        let bytes = manifest_bytes.saturating_add(pixel_bytes);
        let modified = manifest
            .metadata()
            .and_then(|value| value.modified())
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        total = total.saturating_add(bytes);
        artifacts.push((modified, fingerprint.to_string(), bytes, manifest, pixels));
    }
    artifacts.sort_by_key(|entry| entry.0);
    for (_, fingerprint, bytes, manifest, pixels) in artifacts {
        if total <= budget_bytes {
            break;
        }
        if fingerprint == protected {
            continue;
        }
        let _ = fs::remove_file(manifest);
        let _ = fs::remove_file(pixels);
        total = total.saturating_sub(bytes);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;

    fn fixture_plan(root: &Path) -> EnhancedDenoisePlanV1 {
        let source = root.join("source.raw");
        fs::write(&source, b"physical source").unwrap();
        EnhancedDenoisePlanV1::legacy_adapter(&source, "bm3d", 0.4).unwrap()
    }

    fn fixture_image(value: f32) -> DynamicImage {
        DynamicImage::ImageRgb32F(ImageBuffer::from_fn(4, 3, |x, _| {
            Rgb([value + x as f32, -0.1, 1.2])
        }))
    }

    fn fixture_output(value: f32) -> EnhancedDenoiseBuildOutput {
        let image = fixture_image(value);
        EnhancedDenoiseBuildOutput {
            input_range: SceneRangeCounts::measure(&image.to_rgb32f()),
            image,
        }
    }

    #[test]
    fn same_physical_source_plan_is_single_flight_and_virtual_copy_agnostic() {
        let temp = tempfile::tempdir().unwrap();
        let plan = fixture_plan(temp.path());
        let store = Arc::new(EnhancedDenoiseArtifactStore::new(1024 * 1024));
        let builds = Arc::new(AtomicUsize::new(0));
        let mut threads = Vec::new();
        for _virtual_copy in 0..4 {
            let store = Arc::clone(&store);
            let builds = Arc::clone(&builds);
            let plan = plan.clone();
            let cache = temp.path().join("cache");
            threads.push(thread::spawn(move || {
                store
                    .get_or_build(&cache, plan, || {
                        builds.fetch_add(1, Ordering::SeqCst);
                        thread::sleep(std::time::Duration::from_millis(20));
                        Ok(fixture_output(0.5))
                    })
                    .unwrap()
            }));
        }
        let ids: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap().manifest.artifact_id.clone())
            .collect();
        assert!(ids.windows(2).all(|pair| pair[0] == pair[1]));
        assert_eq!(builds.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn verified_disk_artifact_reopens_without_rebuild_and_preserves_scene_range() {
        let temp = tempfile::tempdir().unwrap();
        let plan = fixture_plan(temp.path());
        let cache = temp.path().join("cache");
        EnhancedDenoiseArtifactStore::new(1)
            .get_or_build(&cache, plan.clone(), || Ok(fixture_output(0.5)))
            .unwrap();
        let builds = AtomicUsize::new(0);
        let reopened = EnhancedDenoiseArtifactStore::new(1024 * 1024)
            .get_or_build(&cache, plan, || {
                builds.fetch_add(1, Ordering::SeqCst);
                Ok(fixture_output(0.0))
            })
            .unwrap();
        assert_eq!(builds.load(Ordering::SeqCst), 0);
        let pixels = reopened.image.to_rgb32f();
        assert!(pixels.as_raw().iter().any(|value| *value < 0.0));
        assert!(pixels.as_raw().iter().any(|value| *value > 1.0));
    }

    #[test]
    fn corrupt_artifact_is_quarantined_and_rebuilt() {
        let temp = tempfile::tempdir().unwrap();
        let plan = fixture_plan(temp.path());
        let cache = temp.path().join("cache");
        let fingerprint = plan.fingerprint().unwrap();
        EnhancedDenoiseArtifactStore::new(1)
            .get_or_build(&cache, plan.clone(), || Ok(fixture_output(0.5)))
            .unwrap();
        let (pixels, _) = artifact_paths(&cache, &fingerprint);
        fs::write(&pixels, b"corrupt").unwrap();
        let builds = AtomicUsize::new(0);
        EnhancedDenoiseArtifactStore::new(1)
            .get_or_build(&cache, plan, || {
                builds.fetch_add(1, Ordering::SeqCst);
                Ok(fixture_output(0.8))
            })
            .unwrap();
        assert_eq!(builds.load(Ordering::SeqCst), 1);
        assert!(pixels.with_extension("rgbf32.quarantine").exists());
    }

    #[test]
    fn source_replacement_and_algorithm_changes_invalidate_identity() {
        let temp = tempfile::tempdir().unwrap();
        let first = fixture_plan(temp.path());
        let source = temp.path().join("source.raw");
        fs::write(&source, b"replacement source is different").unwrap();
        let replacement = EnhancedDenoisePlanV1::legacy_adapter(&source, "bm3d", 0.4).unwrap();
        let ai = EnhancedDenoisePlanV1::legacy_adapter(&source, "ai", 0.4).unwrap();
        assert_ne!(
            first.fingerprint().unwrap(),
            replacement.fingerprint().unwrap()
        );
        assert_ne!(
            replacement.fingerprint().unwrap(),
            ai.fingerprint().unwrap()
        );
    }

    #[test]
    fn disk_budget_evicts_oldest_complete_artifact_pair() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.raw");
        fs::write(&source, b"physical source").unwrap();
        let first = EnhancedDenoisePlanV1::legacy_adapter(&source, "bm3d", 0.2).unwrap();
        let second = EnhancedDenoisePlanV1::legacy_adapter(&source, "bm3d", 0.8).unwrap();
        let first_id = first.fingerprint().unwrap();
        let second_id = second.fingerprint().unwrap();
        let cache = temp.path().join("cache");
        let store = EnhancedDenoiseArtifactStore::with_budgets(1, 1);
        store
            .get_or_build(&cache, first, || Ok(fixture_output(0.2)))
            .unwrap();
        store
            .get_or_build(&cache, second, || Ok(fixture_output(0.8)))
            .unwrap();
        let (first_pixels, first_manifest) = artifact_paths(&cache, &first_id);
        let (second_pixels, second_manifest) = artifact_paths(&cache, &second_id);
        assert!(!first_pixels.exists());
        assert!(!first_manifest.exists());
        assert!(second_pixels.exists());
        assert!(second_manifest.exists());
    }
}
