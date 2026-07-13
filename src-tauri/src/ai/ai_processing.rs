use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use image::imageops::{self, FilterType};
use image::{
    DynamicImage, GenericImageView, GrayImage, ImageBuffer, Luma, Rgb, Rgb32FImage, Rgba, RgbaImage,
};
use ndarray::{Array, Array4, IxDyn};
use rapidraw_ai::ort::session::Session;
use rapidraw_ai::ort::value::Tensor;
use rapidraw_ai::tokenizers::Tokenizer;
use tauri::Emitter;
use tauri::Manager;

use super::model_download::{
    AiTransferProgress, cleanup_stale_download, download_verified_atomic, verify_model_file_cached,
};
use super::model_registry::{
    AiCapability, AiModelId, AiModelLease, AiModelRegistry, AiSessionHandle, ClipModels,
};
pub use super::types::{
    AiDepthMaskParameters, AiForegroundMaskParameters, AiSkyMaskParameters, AiSubjectMaskParameters,
};

const ENCODER_URL: &str = "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/sam_vit_b_01ec64_encoder.onnx?download=true";
const DECODER_URL: &str = "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/sam_vit_b_01ec64_decoder.onnx?download=true";
const ENCODER_FILENAME: &str = "sam_vit_b_01ec64_encoder.onnx";
const DECODER_FILENAME: &str = "sam_vit_b_01ec64_decoder.onnx";
const SAM_INPUT_SIZE: u32 = 1024;
const ENCODER_SHA256: &str = "16ab73d9c824886f0de2938c19df22fb9ec3deebfd0de58e65177e479213d7d1";
const DECODER_SHA256: &str = "85d0d672cf5b7fe763edcde429e5533e62f674af4b15c7d688b7673b0ef00bf7";

const U2NETP_URL: &str =
    "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/u2net.onnx?download=true";
const U2NETP_FILENAME: &str = "u2net.onnx";
const U2NETP_INPUT_SIZE: u32 = 320;
const U2NETP_SHA256: &str = "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491";

const SKYSEG_URL: &str = "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/skyseg-u2net.onnx?download=true";
const SKYSEG_FILENAME: &str = "skyseg_u2net.onnx";
const SKYSEG_INPUT_SIZE: u32 = 320;
const SKYSEG_SHA256: &str = "ab9c34c64c3d821220a2886a4a06da4642ffa14d5b30e8d5339056a089aa1d39";

const CLIP_MODEL_URL: &str =
    "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/clip_model.onnx?download=true";
const CLIP_MODEL_FILENAME: &str = "clip_model.onnx";
const CLIP_TOKENIZER_URL: &str = "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/clip_tokenizer.json?download=true";
const CLIP_TOKENIZER_FILENAME: &str = "clip_tokenizer.json";
const CLIP_TOKENIZER_SHA256: &str =
    "b556ac8c99757ffb677208af34bc8c6721572114111a6e0aaf5fa69ff0b8d842";
const CLIP_MODEL_SHA256: &str = "57879bb1c23cdeb350d23569dd251ed4b740a96d747c529e94a2bb8040ac5d00";

const DENOISE_URL: &str = "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/nind_denoise_utnet_684.onnx?download=true";
const DENOISE_FILENAME: &str = "nind_denoise_utnet_684.onnx";
const DENOISE_SHA256: &str = "ee3586279d514df557ff3f7dec6df37fafc51ba5d3a3435b2cc9ac2d9017e7fe";

const LAMA_URL: &str =
    "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/lama_fp16.onnx?download=true";
const LAMA_FILENAME: &str = "lama_fp16.onnx";
const LAMA_SHA256: &str = "2d6be6277c400d6f1b91819737f7c3da935e5c63d1b521d393be1196a2bfa82c";

const DEPTH_URL: &str = "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/depth_anything_v2_vits.onnx?download=true";
const DEPTH_FILENAME: &str = "depth_anything_v2_vits.onnx";
const DEPTH_INPUT_SIZE: u32 = 518;
const DEPTH_SHA256: &str = "d2b11a11c1d4a12b47608fa65a17ee9a4c605b55ee1730c8e3b526304f2562be";

pub const PERSON_PART_PARSER_MODEL_ID: &str = "Metal3d/deeplabv3p-resnet50-human";
pub const PERSON_PART_PARSER_URL: &str = "https://huggingface.co/Metal3d/deeplabv3p-resnet50-human/resolve/main/deeplabv3p-resnet50-human.onnx?download=true";
pub const PERSON_PART_PARSER_FILENAME: &str = "deeplabv3p-resnet50-human.onnx";
pub const PERSON_PART_PARSER_INPUT_SIZE: u32 = 512;
pub const PERSON_PART_PARSER_SHA256: &str =
    "a6e823a82da10ba24c29adfb544130684568c46bfac865e215bbace3b4035a71";

#[derive(Clone, Copy)]
struct AiModelDescriptor {
    id: AiModelId,
    filename: &'static str,
    url: &'static str,
    sha256: &'static str,
    estimated_session_bytes: u64,
}

fn model_descriptor(id: AiModelId) -> AiModelDescriptor {
    let capability = match id {
        AiModelId::SamEncoder | AiModelId::SamDecoder => AiCapability::SamMask,
        AiModelId::ForegroundU2Net => AiCapability::ForegroundMask,
        AiModelId::SkyU2Net => AiCapability::SkyMask,
        AiModelId::DepthAnything => AiCapability::DepthMask,
        AiModelId::Denoise => AiCapability::Denoise,
        AiModelId::Clip => AiCapability::Tagging,
        AiModelId::Lama => AiCapability::Inpainting,
        AiModelId::PersonPartParser => AiCapability::PersonPartMask,
    };
    debug_assert!(capability.dependencies().contains(&id));
    let (filename, url, sha256, estimated_session_bytes) = match id {
        AiModelId::SamEncoder => (ENCODER_FILENAME, ENCODER_URL, ENCODER_SHA256, 420 << 20),
        AiModelId::SamDecoder => (DECODER_FILENAME, DECODER_URL, DECODER_SHA256, 80 << 20),
        AiModelId::ForegroundU2Net => (U2NETP_FILENAME, U2NETP_URL, U2NETP_SHA256, 220 << 20),
        AiModelId::SkyU2Net => (SKYSEG_FILENAME, SKYSEG_URL, SKYSEG_SHA256, 220 << 20),
        AiModelId::DepthAnything => (DEPTH_FILENAME, DEPTH_URL, DEPTH_SHA256, 300 << 20),
        AiModelId::Denoise => (DENOISE_FILENAME, DENOISE_URL, DENOISE_SHA256, 320 << 20),
        AiModelId::Lama => (LAMA_FILENAME, LAMA_URL, LAMA_SHA256, 420 << 20),
        AiModelId::PersonPartParser => (
            PERSON_PART_PARSER_FILENAME,
            PERSON_PART_PARSER_URL,
            PERSON_PART_PARSER_SHA256,
            280 << 20,
        ),
        AiModelId::Clip => (
            CLIP_MODEL_FILENAME,
            CLIP_MODEL_URL,
            CLIP_MODEL_SHA256,
            360 << 20,
        ),
    };
    AiModelDescriptor {
        id,
        filename,
        url,
        sha256,
        estimated_session_bytes,
    }
}

pub async fn acquire_ort_model(
    app_handle: &tauri::AppHandle,
    registry: &AiModelRegistry,
    id: AiModelId,
) -> Result<AiModelLease> {
    let descriptor = model_descriptor(id);
    let app_handle = app_handle.clone();
    let registry = registry.clone();
    registry
        .acquire_with(
            descriptor.id,
            descriptor.estimated_session_bytes,
            move |context| async move {
                let result: Result<AiSessionHandle, String> = async {
                    let models_dir =
                        get_models_dir(&app_handle).map_err(|error| error.to_string())?;
                    let model_path = models_dir.join(descriptor.filename);
                    let verification_path =
                        models_dir.join(format!("{}.verified.json", descriptor.filename));
                    cleanup_stale_download(&model_path).map_err(|error| error.to_string())?;
                    let verified = if model_path.exists() {
                        let _ = app_handle.emit(
                            crate::events::AI_MODEL_DOWNLOAD_START,
                            serde_json::json!({ "modelId": descriptor.id, "phase": "verifying" }),
                        );
                        let path = model_path.clone();
                        let expected = descriptor.sha256.to_string();
                        let verification = verification_path.clone();
                        tokio::task::spawn_blocking(move || {
                            verify_model_file_cached(&path, &expected, &verification)
                        })
                        .await
                        .map_err(|error| error.to_string())?
                        .is_ok()
                    } else {
                        false
                    };
                    if !verified {
                        let _ = tokio::fs::remove_file(&model_path).await;
                        let _ = app_handle.emit(
                            crate::events::AI_MODEL_DOWNLOAD_START,
                            serde_json::json!({
                                "modelId": descriptor.id,
                                "phase": "downloading",
                                "bytesCurrent": 0
                            }),
                        );
                        let client = reqwest::Client::new();
                        let cancellation = context.cancellation_flag();
                        download_verified_atomic(
                            &client,
                            descriptor.url,
                            &model_path,
                            descriptor.sha256,
                            &cancellation,
                            |AiTransferProgress {
                                 bytes_current,
                                 bytes_total,
                             }| {
                                let _ = app_handle.emit(
                                    crate::events::AI_MODEL_DOWNLOAD_START,
                                    serde_json::json!({
                                        "modelId": descriptor.id,
                                        "phase": "downloading",
                                        "bytesCurrent": bytes_current,
                                        "bytesTotal": bytes_total
                                    }),
                                );
                            },
                        )
                        .await
                        .map_err(|error| error.to_string())?;
                        verify_model_file_cached(
                            &model_path,
                            descriptor.sha256,
                            &verification_path,
                        )
                        .map_err(|error| error.to_string())?;
                    }
                    if context.is_cancelled() {
                        Err("ai_model_load_cancelled".to_string())?;
                    }
                    let _ = app_handle.emit(
                        crate::events::AI_MODEL_DOWNLOAD_START,
                        serde_json::json!({ "modelId": descriptor.id, "phase": "loading" }),
                    );
                    let session = tokio::task::spawn_blocking(move || {
                        rapidraw_ai::build_ort_session(&model_path)
                    })
                    .await
                    .map_err(|error| error.to_string())?
                    .map_err(|error| error.to_string())?;
                    crate::register_exit_handler();
                    Ok(AiSessionHandle::Ort(Arc::new(Mutex::new(session))))
                }
                .await;
                let (phase, error) = match &result {
                    Ok(_) => ("ready", None),
                    Err(error) => ("failed", Some(error.as_str())),
                };
                let _ = app_handle.emit(
                    crate::events::AI_MODEL_DOWNLOAD_FINISH,
                    serde_json::json!({
                        "modelId": descriptor.id,
                        "phase": phase,
                        "error": error,
                    }),
                );
                result
            },
        )
        .await
        .map_err(anyhow::Error::msg)
}

pub async fn acquire_clip_model(
    app_handle: &tauri::AppHandle,
    registry: &AiModelRegistry,
) -> Result<AiModelLease> {
    let descriptor = model_descriptor(AiModelId::Clip);
    let app_handle = app_handle.clone();
    registry
        .acquire_with(
            AiModelId::Clip,
            descriptor.estimated_session_bytes,
            move |context| async move {
                let result: Result<AiSessionHandle, String> = async {
                    let models_dir =
                        get_models_dir(&app_handle).map_err(|error| error.to_string())?;
                    let artifacts = [
                        (descriptor.filename, descriptor.url, descriptor.sha256),
                        (
                            CLIP_TOKENIZER_FILENAME,
                            CLIP_TOKENIZER_URL,
                            CLIP_TOKENIZER_SHA256,
                        ),
                    ];
                    for (filename, url, sha256) in artifacts {
                        let path = models_dir.join(filename);
                        let verification = models_dir.join(format!("{filename}.verified.json"));
                        cleanup_stale_download(&path).map_err(|error| error.to_string())?;
                        let verified = if path.exists() {
                            let _ = app_handle.emit(
                                crate::events::AI_MODEL_DOWNLOAD_START,
                                serde_json::json!({
                                    "modelId": descriptor.id,
                                    "phase": "verifying",
                                }),
                            );
                            let path_for_verify = path.clone();
                            let verification_for_verify = verification.clone();
                            tokio::task::spawn_blocking(move || {
                                verify_model_file_cached(
                                    &path_for_verify,
                                    sha256,
                                    &verification_for_verify,
                                )
                            })
                            .await
                            .map_err(|error| error.to_string())?
                            .is_ok()
                        } else {
                            false
                        };
                        if !verified {
                            let _ = tokio::fs::remove_file(&path).await;
                            let _ = app_handle.emit(
                                crate::events::AI_MODEL_DOWNLOAD_START,
                                serde_json::json!({
                                    "modelId": descriptor.id,
                                    "phase": "downloading",
                                    "bytesCurrent": 0,
                                }),
                            );
                            let client = reqwest::Client::new();
                            let cancellation = context.cancellation_flag();
                            download_verified_atomic(
                                &client,
                                url,
                                &path,
                                sha256,
                                &cancellation,
                                |AiTransferProgress {
                                     bytes_current,
                                     bytes_total,
                                 }| {
                                    let _ = app_handle.emit(
                                        crate::events::AI_MODEL_DOWNLOAD_START,
                                        serde_json::json!({
                                            "modelId": descriptor.id,
                                            "phase": "downloading",
                                            "bytesCurrent": bytes_current,
                                            "bytesTotal": bytes_total,
                                        }),
                                    );
                                },
                            )
                            .await
                            .map_err(|error| error.to_string())?;
                            verify_model_file_cached(&path, sha256, &verification)
                                .map_err(|error| error.to_string())?;
                        }
                    }
                    let model_path = models_dir.join(CLIP_MODEL_FILENAME);
                    let tokenizer_path = models_dir.join(CLIP_TOKENIZER_FILENAME);
                    let _ = app_handle.emit(
                        crate::events::AI_MODEL_DOWNLOAD_START,
                        serde_json::json!({ "modelId": descriptor.id, "phase": "loading" }),
                    );
                    let model = tokio::task::spawn_blocking(move || {
                        rapidraw_ai::build_ort_session(&model_path)
                    })
                    .await
                    .map_err(|error| error.to_string())?
                    .map_err(|error| error.to_string())?;
                    let tokenizer =
                        Tokenizer::from_file(tokenizer_path).map_err(|error| error.to_string())?;
                    crate::register_exit_handler();
                    Ok(AiSessionHandle::Clip(Arc::new(ClipModels {
                        model: Mutex::new(model),
                        tokenizer,
                    })))
                }
                .await;
                let (phase, error) = match &result {
                    Ok(_) => ("ready", None),
                    Err(error) => ("failed", Some(error.as_str())),
                };
                let _ = app_handle.emit(
                    crate::events::AI_MODEL_DOWNLOAD_FINISH,
                    serde_json::json!({
                        "modelId": descriptor.id,
                        "phase": phase,
                        "error": error,
                    }),
                );
                result
            },
        )
        .await
        .map_err(anyhow::Error::msg)
}

pub struct AiCapabilityLeaseSet {
    leases: Vec<AiModelLease>,
}

impl AiCapabilityLeaseSet {
    pub fn lease(&self, id: AiModelId) -> Result<&AiModelLease, String> {
        self.leases
            .iter()
            .find(|lease| lease.id() == id)
            .ok_or_else(|| format!("ai_capability_dependency_missing:{id:?}"))
    }
}

pub async fn acquire_capability(
    app_handle: &tauri::AppHandle,
    registry: &AiModelRegistry,
    capability: AiCapability,
) -> Result<AiCapabilityLeaseSet> {
    let mut leases = Vec::with_capacity(capability.dependencies().len());
    for id in capability.dependencies() {
        let lease = if *id == AiModelId::Clip {
            acquire_clip_model(app_handle, registry).await?
        } else {
            acquire_ort_model(app_handle, registry, *id).await?
        };
        leases.push(lease);
    }
    Ok(AiCapabilityLeaseSet { leases })
}

#[derive(Clone)]
pub struct ImageEmbeddings {
    pub path_hash: String,
    pub embeddings: Array<f32, IxDyn>,
    pub original_size: (u32, u32),
}

#[derive(Clone)]
pub struct CachedDepthMap {
    pub path_hash: String,
    pub depth_image: GrayImage,
    pub original_size: (u32, u32),
}

fn edt_1d(f: &mut [f32], v: &mut [usize], z: &mut [f32], d: &mut [f32]) {
    let n = f.len();
    if n == 0 {
        return;
    }
    let mut k = 0;
    v[0] = 0;
    z[0] = f32::NEG_INFINITY;
    z[1] = f32::INFINITY;
    for q in 1..n {
        let mut s = ((f[q] + (q * q) as f32) - (f[v[k]] + (v[k] * v[k]) as f32))
            / (2.0 * (q as f32 - v[k] as f32));
        while s <= z[k] {
            if k == 0 {
                break;
            }
            k -= 1;
            s = ((f[q] + (q * q) as f32) - (f[v[k]] + (v[k] * v[k]) as f32))
                / (2.0 * (q as f32 - v[k] as f32));
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = f32::INFINITY;
    }
    k = 0;
    for (q, d_q) in d[..n].iter_mut().enumerate() {
        while z[k + 1] < q as f32 {
            k += 1;
        }
        let diff = q as f32 - v[k] as f32;
        *d_q = diff * diff + f[v[k]];
    }
    f.copy_from_slice(&d[..n]);
}

fn edt_2d(grid: &[bool], width: usize, height: usize) -> Vec<f32> {
    let area = width * height;
    let mut f = vec![0.0; area];
    for i in 0..area {
        f[i] = if grid[i] { 1e10 } else { 0.0 };
    }

    let max_dim = width.max(height);
    let mut v = vec![0; max_dim];
    let mut z = vec![0.0; max_dim + 1];
    let mut d = vec![0.0; max_dim];

    for y in 0..height {
        let start = y * width;
        let end = start + width;
        edt_1d(&mut f[start..end], &mut v, &mut z, &mut d);
    }

    let mut col = vec![0.0; height];
    for x in 0..width {
        for y in 0..height {
            col[y] = f[y * width + x];
        }
        edt_1d(&mut col, &mut v, &mut z, &mut d);
        for y in 0..height {
            f[y * width + x] = col[y];
        }
    }

    f.into_iter().map(|v| v.sqrt()).collect()
}

fn get_models_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf> {
    let models_dir = app_handle.path().app_data_dir()?.join("models");
    if !models_dir.exists() {
        fs::create_dir_all(&models_dir)?;
    }
    Ok(models_dir)
}

#[derive(Clone, Copy)]
struct TileParams {
    cs: usize,
    ucs: usize,
    overlap: usize,
    pad: usize,
}

impl TileParams {
    const fn new(cs: usize, ucs: usize, overlap: usize) -> Self {
        Self {
            cs,
            ucs,
            overlap,
            pad: (cs - ucs) / 2,
        }
    }
}

const TILE_BALANCED: TileParams = TileParams::new(504, 480, 6);
const TILE_FASTER: TileParams = TileParams::new(504, 504, 0);
const TILE_HIGHER_QUALITY: TileParams = TileParams::new(504, 448, 12);

fn select_tile_params(quality_0_1: f32) -> TileParams {
    let q = quality_0_1.clamp(0.0, 1.0);
    if q <= 0.25 {
        TILE_FASTER
    } else if q >= 0.75 {
        TILE_HIGHER_QUALITY
    } else {
        TILE_BALANCED
    }
}

#[inline]
fn mirror_coord(c: i32, size: i32) -> i32 {
    if c < 0 {
        (-c).min(size - 1)
    } else if c >= size {
        (2 * size - 1 - c).max(0)
    } else {
        c
    }
}

fn extract_tile_mirror(img: &Rgb32FImage, x0: i32, y0: i32, cs: usize) -> Array4<f32> {
    let (w, h) = (img.width() as i32, img.height() as i32);
    let mut arr = Array4::zeros((1, 3, cs, cs));
    for dy in 0..cs as i32 {
        for dx in 0..cs as i32 {
            let sx = mirror_coord(x0 + dx, w);
            let sy = mirror_coord(y0 + dy, h);
            let px = img.get_pixel(sx as u32, sy as u32);
            arr[[0, 0, dy as usize, dx as usize]] = px[0];
            arr[[0, 1, dy as usize, dx as usize]] = px[1];
            arr[[0, 2, dy as usize, dx as usize]] = px[2];
        }
    }
    arr
}

struct SeamlessBlend {
    ud0: usize,
    ud1: usize,
    ud2: usize,
    ud3: usize,
    absx0: usize,
    absy0: usize,
    fswidth: usize,
    fsheight: usize,
    overlap: usize,
}

fn apply_seamless(tile: &mut Array4<f32>, blend: &SeamlessBlend) {
    let SeamlessBlend {
        ud0,
        ud1,
        ud2,
        ud3,
        absx0,
        absy0,
        fswidth,
        fsheight,
        overlap,
    } = *blend;
    let ol = overlap;
    if absx0 > 0 {
        for c in 0..3 {
            for y in ud1..ud3 {
                for x in ud0..(ud0 + ol).min(ud2) {
                    tile[[0, c, y, x]] *= 0.5;
                }
            }
        }
    }
    if absy0 > 0 {
        for c in 0..3 {
            for y in ud1..(ud1 + ol).min(ud3) {
                for x in ud0..ud2 {
                    tile[[0, c, y, x]] *= 0.5;
                }
            }
        }
    }
    if absx0 + (ud2 - ud0) < fswidth && ol > 0 {
        let right_start = (ud2 as i32 - ol as i32).max(ud0 as i32) as usize;
        for c in 0..3 {
            for y in ud1..ud3 {
                for x in right_start..ud2 {
                    tile[[0, c, y, x]] *= 0.5;
                }
            }
        }
    }
    if absy0 + (ud3 - ud1) < fsheight && ol > 0 {
        let bottom_start = (ud3 as i32 - ol as i32).max(ud1 as i32) as usize;
        for c in 0..3 {
            for y in bottom_start..ud3 {
                for x in ud0..ud2 {
                    tile[[0, c, y, x]] *= 0.5;
                }
            }
        }
    }
}

fn run_native_denoise(
    img: &Rgb32FImage,
    session: &Mutex<Session>,
    accumulator: &mut [f32],
    width: usize,
    height: usize,
    progress: &dyn Fn(String),
    params: TileParams,
) -> Result<()> {
    let w = width as i32;
    let h = height as i32;
    let step = params.ucs.saturating_sub(params.overlap).max(1);
    let iperhl = (width.saturating_sub(params.ucs) as f64 / step as f64).ceil() as usize;
    let ipervl = (height.saturating_sub(params.ucs) as f64 / step as f64).ceil() as usize;
    let total = (iperhl + 1) * (ipervl + 1);

    for i in 0..total {
        let yi = i / (iperhl + 1);
        let xi = i % (iperhl + 1);
        let x0 =
            params.ucs as i32 * xi as i32 - params.overlap as i32 * xi as i32 - params.pad as i32;
        let y0 =
            params.ucs as i32 * yi as i32 - params.overlap as i32 * yi as i32 - params.pad as i32;

        if i % 10 == 0 {
            let pct = (i as f32 / total as f32) * 100.0;
            progress(format!("Denoising… {:.0}%", pct));
        }

        let crop = extract_tile_mirror(img, x0, y0, params.cs);
        let input_values = crop.as_standard_layout().to_owned();
        let t_input = Tensor::from_array(input_values)?;

        let out = {
            let mut sess = session.lock().unwrap();
            let outputs = sess.run(rapidraw_ai::ort::inputs![t_input])?;
            let arr = outputs[0].try_extract_array::<f32>()?.to_owned();
            arr.into_dimensionality::<ndarray::Ix4>()
                .map_err(|e| anyhow::anyhow!("Unexpected output shape: {}", e))?
        };

        let x1pad = (0i32).max(x0 + params.cs as i32 - w) as usize;
        let y1pad = (0i32).max(y0 + params.cs as i32 - h) as usize;
        let ud0 = params.pad;
        let ud1 = params.pad;
        let ud2 = params.cs - params.pad.max(x1pad);
        let ud3 = params.cs - params.pad.max(y1pad);
        let absx0 = (x0 + params.pad as i32).max(0) as usize;
        let absy0 = (y0 + params.pad as i32).max(0) as usize;

        let mut tile = out;
        apply_seamless(
            &mut tile,
            &SeamlessBlend {
                ud0,
                ud1,
                ud2,
                ud3,
                absx0,
                absy0,
                fswidth: width,
                fsheight: height,
                overlap: params.overlap,
            },
        );

        for cy in 0..(ud3 - ud1) {
            for cx in 0..(ud2 - ud0) {
                let gx = absx0 + cx;
                let gy = absy0 + cy;
                if gx < width && gy < height {
                    let base = (gy * width + gx) * 3;
                    accumulator[base] += tile[[0, 0, ud1 + cy, ud0 + cx]].clamp(0.0, 1.0);
                    accumulator[base + 1] += tile[[0, 1, ud1 + cy, ud0 + cx]].clamp(0.0, 1.0);
                    accumulator[base + 2] += tile[[0, 2, ud1 + cy, ud0 + cx]].clamp(0.0, 1.0);
                }
            }
        }
    }
    Ok(())
}

fn accumulator_to_rgb32f(acc: &[f32], width: u32, height: u32) -> Rgb32FImage {
    let mut out = Rgb32FImage::new(width, height);
    for (i, p) in out.pixels_mut().enumerate() {
        let i3 = i * 3;
        *p = Rgb([
            acc[i3].clamp(0.0, 1.0),
            acc[i3 + 1].clamp(0.0, 1.0),
            acc[i3 + 2].clamp(0.0, 1.0),
        ]);
    }
    out
}

pub fn run_ai_denoise(
    rgb_img: &Rgb32FImage,
    intensity: f32,
    session: &Mutex<Session>,
    app_handle: &tauri::AppHandle,
) -> Result<DynamicImage> {
    run_ai_denoise_with_progress(rgb_img, intensity, session, &|message| {
        let _ = app_handle.emit(crate::events::DENOISE_PROGRESS, message);
    })
}

#[cfg(test)]
pub fn run_ai_denoise_headless(
    rgb_img: &Rgb32FImage,
    intensity: f32,
    session: &Mutex<Session>,
) -> Result<DynamicImage> {
    run_ai_denoise_with_progress(rgb_img, intensity, session, &|_| {})
}

fn run_ai_denoise_with_progress(
    rgb_img: &Rgb32FImage,
    intensity: f32,
    session: &Mutex<Session>,
    progress: &dyn Fn(String),
) -> Result<DynamicImage> {
    let (width, height) = rgb_img.dimensions();
    let params = select_tile_params(intensity);

    progress("Denoising (AI NIND)...".to_string());
    let mut accumulator = vec![0.0f32; width as usize * height as usize * 3];
    run_native_denoise(
        rgb_img,
        session,
        &mut accumulator,
        width as usize,
        height as usize,
        progress,
        params,
    )?;

    let out_img_buffer = accumulator_to_rgb32f(&accumulator, width, height);
    Ok(DynamicImage::ImageRgb32F(out_img_buffer))
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::Mutex;

    use image::{Rgb, Rgb32FImage};
    use ndarray::Array4;
    use sha2::{Digest, Sha256};

    use super::{ImageEmbeddings, run_ai_denoise_headless, run_sam_decoder};

    #[test]
    fn sam_decoder_real_model_returns_bounded_mask_when_configured() {
        let Some(model_path) = std::env::var_os("RAWENGINE_AI_SAM_DECODER_MODEL_PATH") else {
            eprintln!(
                "RAWENGINE_AI_SAM_DECODER_MODEL_PATH not set; skipping real SAM decoder smoke."
            );
            return;
        };
        let model_path = Path::new(&model_path);
        assert!(model_path.exists(), "SAM decoder model is missing");
        let session = Mutex::new(
            rapidraw_ai::build_ort_session(model_path).expect("load SAM decoder ONNX model"),
        );
        let embeddings = ImageEmbeddings {
            path_hash: "synthetic-runtime-proof".to_string(),
            embeddings: Array4::<f32>::zeros((1, 256, 64, 64)).into_dyn(),
            original_size: (32, 32),
        };
        let output = run_sam_decoder(&session, &embeddings, (16.0, 16.0), (16.0, 16.0))
            .expect("run real SAM decoder inference");
        assert_eq!(output.dimensions(), (32, 32));
        assert_eq!(output.as_raw().len(), 32 * 32);
        assert!(output.as_raw().iter().all(|value| matches!(value, 0 | 255)));
        let digest = hex::encode(Sha256::digest(output.as_raw()));
        let selected_pixels = output
            .as_raw()
            .iter()
            .filter(|value| **value == 255)
            .count();
        println!(
            "SAM_RUNTIME_RECEIPT dimensions=32x32 bytes={} selected_pixels={} sha256={digest}",
            output.as_raw().len(),
            selected_pixels,
        );
    }

    #[test]
    fn ai_denoise_headless_smoke_uses_real_nind_model_when_configured() {
        let Some(model_path) = std::env::var_os("RAWENGINE_AI_DENOISE_MODEL_PATH") else {
            eprintln!("RAWENGINE_AI_DENOISE_MODEL_PATH not set; skipping real NIND smoke.");
            return;
        };
        let model_path = Path::new(&model_path);
        assert!(
            model_path.exists(),
            "RAWENGINE_AI_DENOISE_MODEL_PATH does not exist: {}",
            model_path.display()
        );

        let session =
            Mutex::new(rapidraw_ai::build_ort_session(model_path).expect("load NIND ONNX model"));
        let input = build_smoke_input();
        let output =
            run_ai_denoise_headless(&input, 0.5, &session).expect("run headless NIND denoise");
        assert_eq!(output.width(), input.width());
        assert_eq!(output.height(), input.height());

        let output_rgb = output.to_rgb32f();
        assert_ne!(
            hash_rgb32f(&input),
            hash_rgb32f(&output_rgb),
            "NIND output should change the input."
        );
    }

    fn build_smoke_input() -> Rgb32FImage {
        let mut image = Rgb32FImage::new(32, 32);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            let checker = if (x + y) % 2 == 0 { 0.04 } else { -0.04 };
            let base = x as f32 / 31.0;
            *pixel = Rgb([
                (base + checker).clamp(0.0, 1.0),
                (y as f32 / 31.0 - checker).clamp(0.0, 1.0),
                ((x + y) as f32 / 62.0 + checker).clamp(0.0, 1.0),
            ]);
        }
        image
    }

    fn hash_rgb32f(image: &Rgb32FImage) -> Vec<u8> {
        let mut hasher = Sha256::new();
        for pixel in image.pixels() {
            for channel in pixel.0 {
                hasher.update(channel.to_le_bytes());
            }
        }
        hasher.finalize().to_vec()
    }
}

pub fn run_lama_inpainting(
    image: &DynamicImage,
    mask: &GrayImage,
    lama_session: &Mutex<Session>,
) -> Result<RgbaImage> {
    let (w, h) = image.dimensions();

    let (mut min_x, mut min_y) = (w, h);
    let (mut max_x, mut max_y) = (0u32, 0u32);
    let mut has_mask = false;

    for (x, y, p) in mask.enumerate_pixels() {
        if p[0] > 0 {
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
            has_mask = true;
        }
    }

    if !has_mask {
        return Ok(image.to_rgba8());
    }

    let mask_w = max_x - min_x + 1;
    let mask_h = max_y - min_y + 1;

    let pad_x = 128.max((mask_w as f32 * 1.5) as u32);
    let pad_y = 128.max((mask_h as f32 * 1.5) as u32);

    let x0 = min_x.saturating_sub(pad_x);
    let y0 = min_y.saturating_sub(pad_y);
    let x1 = (max_x + pad_x).min(w.saturating_sub(1));
    let y1 = (max_y + pad_y).min(h.saturating_sub(1));

    let crop_w = x1 - x0 + 1;
    let crop_h = y1 - y0 + 1;

    let rgba = image.to_rgba8();

    let cropped_img = imageops::crop_imm(&rgba, x0, y0, crop_w, crop_h).to_image();
    let cropped_mask = imageops::crop_imm(mask, x0, y0, crop_w, crop_h).to_image();

    let max_dim_limit: u32 = 768;
    let needs_downscale = crop_w > max_dim_limit || crop_h > max_dim_limit;

    let (fw, fh, inf_img, inf_mask) = if needs_downscale {
        let scale = max_dim_limit as f32 / crop_w.max(crop_h) as f32;

        let scaled_w = (crop_w as f32 * scale).round().max(1.0) as u32;
        let scaled_h = (crop_h as f32 * scale).round().max(1.0) as u32;

        (
            scaled_w,
            scaled_h,
            imageops::resize(&cropped_img, scaled_w, scaled_h, FilterType::Lanczos3),
            imageops::resize(&cropped_mask, scaled_w, scaled_h, FilterType::Triangle),
        )
    } else {
        (crop_w, crop_h, cropped_img, cropped_mask.clone())
    };

    let align = 64u32;
    let mut tensor_dim = fw.max(fh);
    if tensor_dim % align != 0 {
        tensor_dim += align - (tensor_dim % align);
    }
    let tensor_dim = tensor_dim.max(align) as usize;

    let mut img_tensor = Array::<f32, _>::zeros((1, 3, tensor_dim, tensor_dim));
    let mut msk_tensor = Array::<f32, _>::zeros((1, 1, tensor_dim, tensor_dim));

    for y in 0..tensor_dim {
        for x in 0..tensor_dim {
            let sx = (x as u32).min(fw.saturating_sub(1));
            let sy = (y as u32).min(fh.saturating_sub(1));

            let p = inf_img.get_pixel(sx, sy);
            let m = inf_mask.get_pixel(sx, sy)[0];

            img_tensor[[0, 0, y, x]] = p[0] as f32 / 255.0;
            img_tensor[[0, 1, y, x]] = p[1] as f32 / 255.0;
            img_tensor[[0, 2, y, x]] = p[2] as f32 / 255.0;
            msk_tensor[[0, 0, y, x]] = if m > 0 { 1.0 } else { 0.0 };
        }
    }

    let t_img = Tensor::from_array(img_tensor.into_dyn().as_standard_layout().into_owned())?;
    let t_msk = Tensor::from_array(msk_tensor.into_dyn().as_standard_layout().into_owned())?;

    let output_tensor = {
        let mut session = lama_session.lock().unwrap();
        let outputs = session.run(rapidraw_ai::ort::inputs!["image" => t_img, "mask" => t_msk])?;
        outputs[0].try_extract_array::<f32>()?.to_owned()
    };

    let mut result_inf = RgbaImage::new(fw, fh);
    for y in 0..fh {
        for x in 0..fw {
            let r = output_tensor[[0, 0, y as usize, x as usize]].clamp(0.0, 255.0) as u8;
            let g = output_tensor[[0, 1, y as usize, x as usize]].clamp(0.0, 255.0) as u8;
            let b = output_tensor[[0, 2, y as usize, x as usize]].clamp(0.0, 255.0) as u8;
            result_inf.put_pixel(x, y, Rgba([r, g, b, 255]));
        }
    }

    let result_crop = if needs_downscale {
        imageops::resize(&result_inf, crop_w, crop_h, FilterType::Lanczos3)
    } else {
        result_inf
    };

    let mut final_image = image.to_rgba8();

    for y in 0..crop_h {
        for x in 0..crop_w {
            let m = cropped_mask.get_pixel(x, y)[0];
            if m > 0 {
                let alpha = m as f32 / 255.0;
                let p = result_crop.get_pixel(x, y);
                let gx = x0 + x;
                let gy = y0 + y;
                let orig = final_image.get_pixel(gx, gy);

                let r = (p[0] as f32 * alpha + orig[0] as f32 * (1.0 - alpha)) as u8;
                let g = (p[1] as f32 * alpha + orig[1] as f32 * (1.0 - alpha)) as u8;
                let b = (p[2] as f32 * alpha + orig[2] as f32 * (1.0 - alpha)) as u8;

                final_image.put_pixel(gx, gy, Rgba([r, g, b, 255]));
            }
        }
    }

    Ok(final_image)
}

pub fn generate_image_embeddings(
    image: &DynamicImage,
    encoder: &Mutex<Session>,
) -> Result<ImageEmbeddings> {
    let (orig_width, orig_height) = image.dimensions();

    let long_side = orig_width.max(orig_height) as f32;
    let scale = SAM_INPUT_SIZE as f32 / long_side;
    let new_width = (orig_width as f32 * scale).round() as u32;
    let new_height = (orig_height as f32 * scale).round() as u32;

    let resized_image = image.resize(new_width, new_height, FilterType::Triangle);
    let rgb_image = resized_image.into_rgb8();
    let (actual_width, actual_height) = rgb_image.dimensions();
    let raw_pixels = rgb_image.as_raw();

    let mut input_tensor: Array<u8, _> =
        Array::zeros((1, 3, SAM_INPUT_SIZE as usize, SAM_INPUT_SIZE as usize));

    let w_usize = actual_width as usize;
    for y in 0..(actual_height as usize) {
        for x in 0..w_usize {
            let idx = (y * w_usize + x) * 3;
            input_tensor[[0, 0, y, x]] = raw_pixels[idx];
            input_tensor[[0, 1, y, x]] = raw_pixels[idx + 1];
            input_tensor[[0, 2, y, x]] = raw_pixels[idx + 2];
        }
    }

    let input_tensor_dyn = input_tensor.into_dyn();
    let input_values = input_tensor_dyn.as_standard_layout();
    let input_tensor_ort = Tensor::from_array(input_values.into_owned())?;
    let mut session = encoder.lock().unwrap();
    let outputs = session.run(rapidraw_ai::ort::inputs![input_tensor_ort])?;

    let embeddings = outputs[0].try_extract_array::<f32>()?.to_owned();

    Ok(ImageEmbeddings {
        path_hash: "".to_string(),
        embeddings: embeddings.into_dyn(),
        original_size: (orig_width, orig_height),
    })
}

pub fn run_sam_decoder(
    decoder: &Mutex<Session>,
    embeddings: &ImageEmbeddings,
    start_point: (f64, f64),
    end_point: (f64, f64),
) -> Result<GrayImage> {
    let (orig_width, orig_height) = embeddings.original_size;
    let long_side = orig_width.max(orig_height) as f64;
    let scale = SAM_INPUT_SIZE as f64 / long_side;

    let iters = 2;

    let is_point =
        (start_point.0 - end_point.0).abs() < 1e-6 && (start_point.1 - end_point.1).abs() < 1e-6;
    let mut point_coords = Vec::new();
    let mut point_labels = Vec::new();

    if is_point {
        point_coords.push((
            (start_point.0 * scale) as f32,
            (start_point.1 * scale) as f32,
        ));
        point_labels.push(1.0f32);
    } else {
        let x1 = (start_point.0.min(end_point.0) * scale) as f32;
        let y1 = (start_point.1.min(end_point.1) * scale) as f32;
        let x2 = (start_point.0.max(end_point.0) * scale) as f32;
        let y2 = (start_point.1.max(end_point.1) * scale) as f32;
        point_coords.push((x1, y1));
        point_coords.push((x2, y2));
        point_labels.push(2.0f32);
        point_labels.push(3.0f32);
    }

    let mut mask_input = Array::zeros((1, 1, 256, 256)).into_dyn();
    let mut has_mask_input = 0.0f32;

    let orig_im_size =
        Array::from_shape_vec((2,), vec![orig_height as f32, orig_width as f32])?.into_dyn();

    let mut final_mask_data: Vec<u8> = Vec::new();
    let mut final_w = 0;
    let mut final_h = 0;

    for i in 0..iters {
        let pc_len = point_coords.len();
        let pl_len = point_labels.len();

        let coords_flat: Vec<f32> = point_coords.iter().flat_map(|&(x, y)| vec![x, y]).collect();
        let coords_array = Array::from_shape_vec((1, pc_len, 2), coords_flat)?.into_dyn();
        let labels_array = Array::from_shape_vec((1, pl_len), point_labels.clone())?.into_dyn();

        let t_embeddings = Tensor::from_array(
            embeddings
                .embeddings
                .clone()
                .as_standard_layout()
                .into_owned(),
        )?;
        let t_point_coords = Tensor::from_array(coords_array.as_standard_layout().into_owned())?;
        let t_point_labels = Tensor::from_array(labels_array.as_standard_layout().into_owned())?;
        let t_mask_input =
            Tensor::from_array(mask_input.clone().as_standard_layout().into_owned())?;
        let t_has_mask = Tensor::from_array(
            Array::from_elem((1,), has_mask_input)
                .into_dyn()
                .as_standard_layout()
                .into_owned(),
        )?;
        let t_orig_im_size =
            Tensor::from_array(orig_im_size.clone().as_standard_layout().into_owned())?;

        let mask_tensor = {
            let mut session = decoder.lock().unwrap();
            let outputs = session.run(rapidraw_ai::ort::inputs![
                t_embeddings,
                t_point_coords,
                t_point_labels,
                t_mask_input,
                t_has_mask,
                t_orig_im_size
            ])?;
            outputs[0].try_extract_array::<f32>()?.to_owned()
        };

        let mask_dims = mask_tensor.shape();
        let h = mask_dims[2];
        let w = mask_dims[3];
        let area = h * w;

        let mask_slice = mask_tensor.as_slice().unwrap();
        let first_mask_slice = &mask_slice[0..area];

        if i == iters - 1 {
            final_mask_data = first_mask_slice
                .iter()
                .map(|&val| if val > 0.0 { 255 } else { 0 })
                .collect();
            final_w = w;
            final_h = h;
            break;
        }

        let mut binary_mask = vec![false; area];
        let mut mask_area = 0.0;
        let mut min_x = w;
        let mut min_y = h;
        let mut max_x = 0;
        let mut max_y = 0;

        for (idx, &val) in first_mask_slice.iter().enumerate() {
            if val > 0.0 {
                binary_mask[idx] = true;
                let x = idx % w;
                let y = idx / w;
                min_x = min_x.min(x);
                max_x = max_x.max(x);
                min_y = min_y.min(y);
                max_y = max_y.max(y);
                mask_area += 1.0;
            }
        }

        if mask_area == 0.0 || min_x > max_x {
            final_mask_data = first_mask_slice
                .iter()
                .map(|&val| if val > 0.0 { 255 } else { 0 })
                .collect();
            final_w = w;
            final_h = h;
            break;
        }

        let dt_in = edt_2d(&binary_mask, w, h);
        let mut max_in = 0.0;
        let mut pos_idx = 0;
        for (idx, &v) in dt_in.iter().enumerate() {
            if v > max_in {
                max_in = v;
                pos_idx = idx;
            }
        }
        let pos_y = pos_idx / w;
        let pos_x = pos_idx % w;

        let mut rev_mask = vec![false; area];
        for (idx, is_true) in binary_mask.iter().enumerate() {
            rev_mask[idx] = !is_true;
        }
        let mut dt_out = edt_2d(&rev_mask, w, h);

        for y in 0..h {
            for x in 0..w {
                if x < min_x || x > max_x || y < min_y || y > max_y {
                    dt_out[y * w + x] = 0.0;
                }
            }
        }

        let mut max_out = 0.0;
        let mut neg_idx = 0;
        for (idx, &v) in dt_out.iter().enumerate() {
            if v > max_out {
                max_out = v;
                neg_idx = idx;
            }
        }
        let neg_y = neg_idx / w;
        let neg_x = neg_idx % w;

        point_coords.clear();
        point_labels.clear();

        point_coords.push(((pos_x as f64 * scale) as f32, (pos_y as f64 * scale) as f32));
        point_labels.push(1.0);
        point_coords.push(((neg_x as f64 * scale) as f32, (neg_y as f64 * scale) as f32));
        point_labels.push(0.0);
        point_coords.push(((min_x as f64 * scale) as f32, (min_y as f64 * scale) as f32));
        point_labels.push(2.0);
        point_coords.push(((max_x as f64 * scale) as f32, (max_y as f64 * scale) as f32));
        point_labels.push(3.0);

        let mut gaus_dt = vec![0.0f32; area];
        let variance = (mask_area / 4.0_f32).max(1.0_f32);
        for (idx, &is_true) in binary_mask.iter().enumerate() {
            if is_true {
                let diff = dt_in[idx] - max_in;
                gaus_dt[idx] = (-(diff * diff) / variance).exp();
            }
        }

        let mask_f32_vec: Vec<f32> = first_mask_slice
            .iter()
            .map(|&v| if v > 0.0 { 15.0 } else { -15.0 })
            .collect();

        let img_mask_f32 =
            ImageBuffer::<Luma<f32>, Vec<f32>>::from_raw(w as u32, h as u32, mask_f32_vec).unwrap();
        let img_gaus_f32 =
            ImageBuffer::<Luma<f32>, Vec<f32>>::from_raw(w as u32, h as u32, gaus_dt).unwrap();

        let resized_mask = imageops::resize(&img_mask_f32, 256, 256, FilterType::Triangle);
        let resized_gaus = imageops::resize(&img_gaus_f32, 256, 256, FilterType::Triangle);

        let rm_raw = resized_mask.as_raw();
        let rg_raw = resized_gaus.as_raw();
        let mut mask_input_flat = vec![0.0f32; 256 * 256];

        for i in 0..(256 * 256) {
            let m_val = rm_raw[i];
            let mut g_val = rg_raw[i];
            if g_val <= 0.0 {
                g_val = 1.0;
            }
            mask_input_flat[i] = m_val * g_val;
        }

        mask_input = Array::from_shape_vec((1, 1, 256, 256), mask_input_flat)
            .unwrap()
            .into_dyn();
        has_mask_input = 1.0;
    }

    let gray_mask = GrayImage::from_raw(final_w as u32, final_h as u32, final_mask_data)
        .ok_or_else(|| anyhow::anyhow!("Failed to create mask image from raw data"))?;

    let feathered_mask = image::imageops::blur(&gray_mask, 2.0);

    Ok(feathered_mask)
}

pub fn run_sky_seg_model(
    image: &DynamicImage,
    sky_seg_session: &Mutex<Session>,
) -> Result<GrayImage> {
    let (orig_width, orig_height) = image.dimensions();

    let resized_image = image.resize(SKYSEG_INPUT_SIZE, SKYSEG_INPUT_SIZE, FilterType::Triangle);
    let (resized_w, resized_h) = resized_image.dimensions();
    let resized_rgb = resized_image.into_rgb8();
    let raw_pixels = resized_rgb.as_raw();

    let paste_x = ((SKYSEG_INPUT_SIZE - resized_w) / 2) as usize;
    let paste_y = ((SKYSEG_INPUT_SIZE - resized_h) / 2) as usize;

    let mut input_tensor: Array<f32, _> =
        Array::zeros((1, 3, SKYSEG_INPUT_SIZE as usize, SKYSEG_INPUT_SIZE as usize));

    let mean = [0.485, 0.456, 0.406];
    let std = [0.229, 0.224, 0.225];

    let rw = resized_w as usize;
    let rh = resized_h as usize;

    for y in 0..rh {
        for x in 0..rw {
            let idx = (y * rw + x) * 3;
            let dest_y = y + paste_y;
            let dest_x = x + paste_x;

            input_tensor[[0, 0, dest_y, dest_x]] =
                (raw_pixels[idx] as f32 / 255.0 - mean[0]) / std[0];
            input_tensor[[0, 1, dest_y, dest_x]] =
                (raw_pixels[idx + 1] as f32 / 255.0 - mean[1]) / std[1];
            input_tensor[[0, 2, dest_y, dest_x]] =
                (raw_pixels[idx + 2] as f32 / 255.0 - mean[2]) / std[2];
        }
    }

    let input_tensor_dyn = input_tensor.into_dyn();
    let t_input = Tensor::from_array(input_tensor_dyn.as_standard_layout().into_owned())?;

    let mut session = sky_seg_session.lock().unwrap();
    let outputs = session.run(rapidraw_ai::ort::inputs![t_input])?;
    let output_tensor = outputs[0].try_extract_array::<f32>()?.to_owned();
    let out_slice = output_tensor.as_slice().unwrap();

    let mut min_val = f32::MAX;
    let mut max_val = f32::MIN;
    for &v in out_slice {
        min_val = min_val.min(v);
        max_val = max_val.max(v);
    }

    let range = max_val - min_val;
    let scale = if range > 1e-6 { 255.0 / range } else { 0.0 };

    let usize_size = SKYSEG_INPUT_SIZE as usize;
    let mut cropped_mask_data = Vec::with_capacity(rw * rh);

    for y in 0..rh {
        let src_y = y + paste_y;
        for x in 0..rw {
            let src_x = x + paste_x;
            let val = out_slice[src_y * usize_size + src_x];
            let pixel = if range > 1e-6 {
                ((val - min_val) * scale) as u8
            } else {
                0
            };
            cropped_mask_data.push(pixel);
        }
    }

    let cropped_mask = GrayImage::from_raw(resized_w, resized_h, cropped_mask_data)
        .ok_or_else(|| anyhow::anyhow!("Failed to create mask from Sky Segmentation output"))?;

    let final_mask = imageops::resize(&cropped_mask, orig_width, orig_height, FilterType::Triangle);

    Ok(final_mask)
}

pub fn run_u2netp_model(
    image: &DynamicImage,
    u2netp_session: &Mutex<Session>,
) -> Result<GrayImage> {
    let (orig_width, orig_height) = image.dimensions();

    let resized_image = image.resize(U2NETP_INPUT_SIZE, U2NETP_INPUT_SIZE, FilterType::Triangle);
    let (resized_w, resized_h) = resized_image.dimensions();
    let resized_rgb = resized_image.into_rgb8();
    let raw_pixels = resized_rgb.as_raw();

    let paste_x = ((U2NETP_INPUT_SIZE - resized_w) / 2) as usize;
    let paste_y = ((U2NETP_INPUT_SIZE - resized_h) / 2) as usize;

    let mut input_tensor: Array<f32, _> =
        Array::zeros((1, 3, U2NETP_INPUT_SIZE as usize, U2NETP_INPUT_SIZE as usize));

    let mean = [0.485, 0.456, 0.406];
    let std = [0.229, 0.224, 0.225];

    let rw = resized_w as usize;
    let rh = resized_h as usize;

    for y in 0..rh {
        for x in 0..rw {
            let idx = (y * rw + x) * 3;
            let dest_y = y + paste_y;
            let dest_x = x + paste_x;

            input_tensor[[0, 0, dest_y, dest_x]] =
                (raw_pixels[idx] as f32 / 255.0 - mean[0]) / std[0];
            input_tensor[[0, 1, dest_y, dest_x]] =
                (raw_pixels[idx + 1] as f32 / 255.0 - mean[1]) / std[1];
            input_tensor[[0, 2, dest_y, dest_x]] =
                (raw_pixels[idx + 2] as f32 / 255.0 - mean[2]) / std[2];
        }
    }

    let input_tensor_dyn = input_tensor.into_dyn();
    let t_input = Tensor::from_array(input_tensor_dyn.as_standard_layout().into_owned())?;

    let mut session = u2netp_session.lock().unwrap();
    let outputs = session.run(rapidraw_ai::ort::inputs![t_input])?;
    let output_tensor = outputs[0].try_extract_array::<f32>()?.to_owned();
    let out_slice = output_tensor.as_slice().unwrap();

    let mut min_val = f32::MAX;
    let mut max_val = f32::MIN;
    for &v in out_slice {
        min_val = min_val.min(v);
        max_val = max_val.max(v);
    }

    let range = max_val - min_val;
    let scale = if range > 1e-6 { 255.0 / range } else { 0.0 };

    let usize_size = U2NETP_INPUT_SIZE as usize;
    let mut cropped_mask_data = Vec::with_capacity(rw * rh);

    for y in 0..rh {
        let src_y = y + paste_y;
        for x in 0..rw {
            let src_x = x + paste_x;
            let val = out_slice[src_y * usize_size + src_x];
            let pixel = if range > 1e-6 {
                ((val - min_val) * scale) as u8
            } else {
                0
            };
            cropped_mask_data.push(pixel);
        }
    }

    let cropped_mask = GrayImage::from_raw(resized_w, resized_h, cropped_mask_data)
        .ok_or_else(|| anyhow::anyhow!("Failed to create mask from U-2-Netp output"))?;

    let final_mask = imageops::resize(&cropped_mask, orig_width, orig_height, FilterType::Triangle);

    Ok(final_mask)
}

pub fn run_depth_anything_model(
    image: &DynamicImage,
    depth_session: &Mutex<Session>,
) -> Result<GrayImage> {
    let resized_image = image.resize(DEPTH_INPUT_SIZE, DEPTH_INPUT_SIZE, FilterType::Triangle);
    let (resized_w, resized_h) = resized_image.dimensions();
    let resized_rgb = resized_image.into_rgb8();
    let raw_pixels = resized_rgb.as_raw();

    let paste_x = ((DEPTH_INPUT_SIZE - resized_w) / 2) as usize;
    let paste_y = ((DEPTH_INPUT_SIZE - resized_h) / 2) as usize;

    let mut input_tensor: Array<f32, _> =
        Array::zeros((1, 3, DEPTH_INPUT_SIZE as usize, DEPTH_INPUT_SIZE as usize));

    let mean = [0.485, 0.456, 0.406];
    let std = [0.229, 0.224, 0.225];

    let rw = resized_w as usize;
    let rh = resized_h as usize;

    for y in 0..rh {
        for x in 0..rw {
            let idx = (y * rw + x) * 3;
            let dest_y = y + paste_y;
            let dest_x = x + paste_x;

            input_tensor[[0, 0, dest_y, dest_x]] =
                (raw_pixels[idx] as f32 / 255.0 - mean[0]) / std[0];
            input_tensor[[0, 1, dest_y, dest_x]] =
                (raw_pixels[idx + 1] as f32 / 255.0 - mean[1]) / std[1];
            input_tensor[[0, 2, dest_y, dest_x]] =
                (raw_pixels[idx + 2] as f32 / 255.0 - mean[2]) / std[2];
        }
    }

    let input_tensor_dyn = input_tensor.into_dyn();
    let t_input = Tensor::from_array(input_tensor_dyn.as_standard_layout().into_owned())?;

    let mut session = depth_session.lock().unwrap();
    let outputs = session.run(rapidraw_ai::ort::inputs![t_input])?;
    let output_tensor = outputs[0].try_extract_array::<f32>()?.to_owned();
    let out_slice = output_tensor.as_slice().unwrap();

    let usize_size = DEPTH_INPUT_SIZE as usize;

    let mut min_val = f32::MAX;
    let mut max_val = f32::MIN;
    for y in 0..rh {
        let src_y = y + paste_y;
        for x in 0..rw {
            let src_x = x + paste_x;
            let val = out_slice[src_y * usize_size + src_x];
            min_val = min_val.min(val);
            max_val = max_val.max(val);
        }
    }

    let range = max_val - min_val;
    let scale = if range > 1e-6 { 255.0 / range } else { 0.0 };

    let mut cropped_depth_data = Vec::with_capacity(rw * rh);

    for y in 0..rh {
        let src_y = y + paste_y;
        for x in 0..rw {
            let src_x = x + paste_x;
            let val = out_slice[src_y * usize_size + src_x];
            let pixel = if range > 1e-6 {
                ((val - min_val) * scale) as u8
            } else {
                0
            };
            cropped_depth_data.push(pixel);
        }
    }

    let depth_map = GrayImage::from_raw(resized_w, resized_h, cropped_depth_data)
        .ok_or_else(|| anyhow::anyhow!("Failed to create mask from Depth output"))?;

    Ok(depth_map)
}
