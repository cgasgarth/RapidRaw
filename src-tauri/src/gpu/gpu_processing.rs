use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(test)]
use std::sync::atomic::AtomicBool;

use half::f16;
use image::{DynamicImage, GenericImageView, ImageBuffer, Luma};
use wgpu::util::{DeviceExt, TextureDataOrder};

use crate::gpu_readback::{
    RGBA16_FLOAT_BYTES_PER_PIXEL, read_texture_data_roi_with_bytes_per_pixel,
    rgba16float_readback_to_dynamic_image, rgba16float_readback_to_unclamped_dynamic_image,
};
use crate::gpu_textures::{
    create_dummy_lut_texture_view, create_dummy_rgba16f_texture_view,
    create_rgba16f_texture_with_view,
};
use crate::image_processing::{AllAdjustments, GpuContext, MAX_MASKS};
use crate::lut_processing::Lut;
use crate::mixer_render::apply_native_color_mixer_adjustments;
use crate::render_caches::RenderCaches;
use crate::{AppState, GpuImageCache};

pub const PRE_GPU_PRECISION_ABI_RGBA16F_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct GpuInputCacheCounters {
    pub hits: u64,
    pub misses: u64,
    pub identity_misses: u64,
    pub dimension_misses: u64,
    pub device_misses: u64,
    pub to_rgba_f16_calls: u64,
    pub converted_bytes: u64,
    pub uploaded_bytes: u64,
    pub texture_allocations: u64,
    pub view_allocations: u64,
}

static INPUT_CACHE_HITS: AtomicU64 = AtomicU64::new(0);
static INPUT_CACHE_MISSES: AtomicU64 = AtomicU64::new(0);
static INPUT_IDENTITY_MISSES: AtomicU64 = AtomicU64::new(0);
static INPUT_DIMENSION_MISSES: AtomicU64 = AtomicU64::new(0);
static INPUT_DEVICE_MISSES: AtomicU64 = AtomicU64::new(0);
static TO_RGBA_F16_CALLS: AtomicU64 = AtomicU64::new(0);
static CONVERTED_BYTES: AtomicU64 = AtomicU64::new(0);
static UPLOADED_BYTES: AtomicU64 = AtomicU64::new(0);
static INPUT_TEXTURE_ALLOCATIONS: AtomicU64 = AtomicU64::new(0);
static INPUT_VIEW_ALLOCATIONS: AtomicU64 = AtomicU64::new(0);

pub fn gpu_input_cache_counters() -> GpuInputCacheCounters {
    GpuInputCacheCounters {
        hits: INPUT_CACHE_HITS.load(Ordering::Relaxed),
        misses: INPUT_CACHE_MISSES.load(Ordering::Relaxed),
        identity_misses: INPUT_IDENTITY_MISSES.load(Ordering::Relaxed),
        dimension_misses: INPUT_DIMENSION_MISSES.load(Ordering::Relaxed),
        device_misses: INPUT_DEVICE_MISSES.load(Ordering::Relaxed),
        to_rgba_f16_calls: TO_RGBA_F16_CALLS.load(Ordering::Relaxed),
        converted_bytes: CONVERTED_BYTES.load(Ordering::Relaxed),
        uploaded_bytes: UPLOADED_BYTES.load(Ordering::Relaxed),
        texture_allocations: INPUT_TEXTURE_ALLOCATIONS.load(Ordering::Relaxed),
        view_allocations: INPUT_VIEW_ALLOCATIONS.load(Ordering::Relaxed),
    }
}

#[cfg(all(test, feature = "tauri-test"))]
pub fn reset_gpu_input_cache_counters() {
    for counter in [
        &INPUT_CACHE_HITS,
        &INPUT_CACHE_MISSES,
        &INPUT_IDENTITY_MISSES,
        &INPUT_DIMENSION_MISSES,
        &INPUT_DEVICE_MISSES,
        &TO_RGBA_F16_CALLS,
        &CONVERTED_BYTES,
        &UPLOADED_BYTES,
        &INPUT_TEXTURE_ALLOCATIONS,
        &INPUT_VIEW_ALLOCATIONS,
    ] {
        counter.store(0, Ordering::Relaxed);
    }
}

/// Identity of the finalized pixels uploaded to the GPU input texture.
///
/// `source_revision` distinguishes sessions/sources, while `stage_revision` names the
/// geometry/resolution/detail/retouch pipeline which produced `base_image`. The pixel
/// fingerprint is the correctness backstop: callers cannot accidentally reuse an upload
/// when a pre-GPU stage changes without updating its revision scheme.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct PreGpuImageIdentity {
    pub source_revision: u64,
    pub stage_revision: u64,
    pub pixel_fingerprint: u64,
    pub width: u32,
    pub height: u32,
    pub precision_abi: u32,
}

impl PreGpuImageIdentity {
    pub fn source_revision(source: &str) -> u64 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        source.hash(&mut hasher);
        hasher.finish()
    }

    pub fn for_source(base_image: &DynamicImage, source: &str) -> Self {
        Self::from_image(base_image, Self::source_revision(source), 0)
    }

    pub fn from_image(
        base_image: &DynamicImage,
        source_revision: u64,
        stage_revision: u64,
    ) -> Self {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let (width, height) = base_image.dimensions();
        let mut hasher = DefaultHasher::new();
        base_image.color().hash(&mut hasher);
        base_image.as_bytes().hash(&mut hasher);
        Self {
            source_revision,
            stage_revision,
            pixel_fingerprint: hasher.finish(),
            width,
            height,
            precision_abi: PRE_GPU_PRECISION_ABI_RGBA16F_V1,
        }
    }
}

#[cfg(all(test, feature = "tauri-test"))]
pub use crate::gpu_context::get_or_init_compute_gpu_context_for_tests;
pub use crate::gpu_context::get_or_init_gpu_context;

const GPU_OUTPUT_TEXTURE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const GPU_OUTPUT_BYTES_PER_PIXEL: u32 = RGBA16_FLOAT_BYTES_PER_PIXEL;
const MAX_MASK_BINDINGS: u32 = 1;

const BLUR_FLAG_SHARPNESS: u32 = 1 << 0;
const BLUR_FLAG_TONAL: u32 = 1 << 1;
const BLUR_FLAG_CLARITY: u32 = 1 << 2;
const BLUR_FLAG_STRUCTURE: u32 = 1 << 3;
const BLUR_ABI_VERSION: u32 = 1;
const GPU_RENDER_GRAPH_VERSION: u32 = 1;
const GPU_SHADER_LAYOUT_VERSION: u32 = 1;
static NEXT_PROCESSOR_GENERATION: AtomicU64 = AtomicU64::new(1);

bitflags::bitflags! {
    #[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
    pub struct GpuStageFlags: u32 {
        const BLUR_SHARPNESS = 1 << 0;
        const BLUR_TONAL = 1 << 1;
        const BLUR_CLARITY = 1 << 2;
        const BLUR_STRUCTURE = 1 << 3;
        const FLARE = 1 << 4;
        const MAIN_ADJUST = 1 << 5;
        const LUT = 1 << 6;
        const MASKS = 1 << 7;
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum BlurSemantic {
    Sharpness,
    Tonal,
    Clarity,
    Structure,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct BlurProductSpec {
    pub semantic: BlurSemantic,
    pub radius_bits: u32,
    pub implementation_version: u32,
}

impl BlurProductSpec {
    fn base_radius(self) -> f32 {
        f32::from_bits(self.radius_bits)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GpuRenderGraphPlan {
    pub graph_version: u32,
    pub flags: GpuStageFlags,
    pub blur_products: Vec<BlurProductSpec>,
    pub mask_layer_count: u16,
    pub tile_halo: u32,
    pub fingerprint: u64,
    pub estimated_peak_resource_bytes: u64,
    #[cfg(debug_assertions)]
    pub reasons: Vec<&'static str>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct GpuExecutionReceipt {
    pub graph_fingerprint: u64,
    pub stages: GpuStageFlags,
    pub blur_dispatch_count: u32,
    pub render_pass_count: u32,
    pub command_buffer_count: u32,
    pub queue_submit_count: u32,
    pub estimated_peak_resource_bytes: u64,
    pub cpu_encode_time: Duration,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct BlurPassNeeds {
    sharpness: bool,
    tonal: bool,
    clarity: bool,
    structure: bool,
}

#[cfg(test)]
static FORCE_ALL_BLUR_PASSES: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
static FORCE_DISABLE_BLUR_CACHE: AtomicBool = AtomicBool::new(false);

impl BlurPassNeeds {
    fn flags(self) -> u32 {
        (u32::from(self.sharpness) * BLUR_FLAG_SHARPNESS)
            | (u32::from(self.tonal) * BLUR_FLAG_TONAL)
            | (u32::from(self.clarity) * BLUR_FLAG_CLARITY)
            | (u32::from(self.structure) * BLUR_FLAG_STRUCTURE)
    }
}

fn resolve_blur_pass_needs(adjustments: &AllAdjustments) -> BlurPassNeeds {
    let global = &adjustments.global;
    let mut needs = BlurPassNeeds {
        sharpness: global.sharpness != 0.0,
        tonal: global.contrast != 0.0
            || global.highlights != 0.0
            || global.shadows != 0.0
            || global.whites != 0.0
            || global.blacks != 0.0,
        clarity: global.clarity != 0.0 || global.centré != 0.0 || global.halation_amount > 0.0,
        structure: global.structure != 0.0 || global.dehaze != 0.0 || global.glow_amount > 0.0,
    };

    let mask_count = (adjustments.mask_count as usize).min(MAX_MASKS);
    for mask in &adjustments.mask_adjustments[..mask_count] {
        needs.sharpness |= mask.sharpness.abs() > 0.001;
        needs.tonal |= mask.contrast != 0.0
            || mask.highlights != 0.0
            || mask.shadows != 0.0
            || mask.whites != 0.0
            || mask.blacks != 0.0;
        needs.clarity |= mask.clarity != 0.0 || mask.halation_amount > 0.0;
        needs.structure |= mask.structure != 0.0 || mask.dehaze != 0.0 || mask.glow_amount > 0.0;
    }
    needs
}

pub fn compile_gpu_render_graph(
    adjustments: &AllAdjustments,
    has_lut: bool,
    mask_layer_count: usize,
    width: u32,
    height: u32,
) -> GpuRenderGraphPlan {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let needs = resolve_blur_pass_needs(adjustments);
    let scale = width.min(height) as f32 / 1080.0;
    let definitions = [
        (
            needs.sharpness,
            BlurSemantic::Sharpness,
            1.0,
            GpuStageFlags::BLUR_SHARPNESS,
        ),
        (
            needs.tonal,
            BlurSemantic::Tonal,
            3.5,
            GpuStageFlags::BLUR_TONAL,
        ),
        (
            needs.clarity,
            BlurSemantic::Clarity,
            8.0,
            GpuStageFlags::BLUR_CLARITY,
        ),
        (
            needs.structure,
            BlurSemantic::Structure,
            40.0,
            GpuStageFlags::BLUR_STRUCTURE,
        ),
    ];
    let mut flags = GpuStageFlags::MAIN_ADJUST;
    let mut blur_products = Vec::with_capacity(4);
    for (active, semantic, radius, flag) in definitions {
        if active {
            flags |= flag;
            blur_products.push(BlurProductSpec {
                semantic,
                radius_bits: f32::to_bits(radius),
                implementation_version: BLUR_ABI_VERSION,
            });
        }
    }
    if adjustments.global.flare_amount > 0.0 {
        flags |= GpuStageFlags::FLARE;
    }
    if has_lut {
        flags |= GpuStageFlags::LUT;
    }
    let active_masks = (adjustments.mask_count as usize)
        .min(mask_layer_count)
        .min(MAX_MASKS);
    if active_masks > 0 {
        flags |= GpuStageFlags::MASKS;
    }
    let tile_halo = blur_products
        .iter()
        .map(|spec| (spec.base_radius() * scale).ceil().max(1.0) as u32)
        .max()
        .unwrap_or(0);
    let tile_edge = 2048_u64 + u64::from(tile_halo) * 2;
    let live_blur_surfaces = blur_products.len() as u64 + u64::from(!blur_products.is_empty());
    let estimated_peak_resource_bytes = tile_edge * tile_edge * 8 * (2 + live_blur_surfaces);
    let mut hasher = DefaultHasher::new();
    GPU_RENDER_GRAPH_VERSION.hash(&mut hasher);
    GPU_SHADER_LAYOUT_VERSION.hash(&mut hasher);
    flags.hash(&mut hasher);
    blur_products.hash(&mut hasher);
    active_masks.hash(&mut hasher);
    tile_halo.hash(&mut hasher);
    let fingerprint = hasher.finish();

    GpuRenderGraphPlan {
        graph_version: GPU_RENDER_GRAPH_VERSION,
        flags,
        blur_products,
        mask_layer_count: active_masks as u16,
        tile_halo,
        fingerprint,
        estimated_peak_resource_bytes,
        #[cfg(debug_assertions)]
        reasons: graph_reasons(adjustments, has_lut, active_masks),
    }
}

#[cfg(debug_assertions)]
fn graph_reasons(
    adjustments: &AllAdjustments,
    has_lut: bool,
    active_masks: usize,
) -> Vec<&'static str> {
    let needs = resolve_blur_pass_needs(adjustments);
    let mut reasons = vec!["MAIN_ADJUST required by render output"];
    for (active, reason) in [
        (needs.sharpness, "BLUR_SHARPNESS required by sharpness"),
        (needs.tonal, "BLUR_TONAL required by tonal adjustments"),
        (
            needs.clarity,
            "BLUR_CLARITY required by clarity/centre/halation",
        ),
        (
            needs.structure,
            "BLUR_STRUCTURE required by structure/dehaze/glow",
        ),
        (
            adjustments.global.flare_amount > 0.0,
            "FLARE required by flare_amount",
        ),
        (has_lut, "LUT required by render request"),
        (
            active_masks > 0,
            "MASKS required by active local adjustments",
        ),
    ] {
        if active {
            reasons.push(reason);
        }
    }
    reasons
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct BlurPassCounters {
    families_requested: u32,
    encoders: u32,
    bind_groups: u32,
    dispatches: u32,
    submissions: u32,
    pixels_processed: u64,
    cache_hits: u32,
    cache_misses: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct BlurSurfaceKey {
    processor_generation: u64,
    device_generation: u64,
    input_identity: PreGpuImageIdentity,
    input_width: u32,
    input_height: u32,
    tile_x: u32,
    tile_y: u32,
    tile_width: u32,
    tile_height: u32,
    input_x_start: u32,
    input_y_start: u32,
    input_width_with_overlap: u32,
    input_height_with_overlap: u32,
    radius_px: u32,
    blur_abi_version: u32,
}

#[derive(Clone, Copy, Debug)]
enum BlurFamily {
    Sharpness = 0,
    Tonal = 1,
    Clarity = 2,
    Structure = 3,
}

#[derive(Debug, Default)]
struct BlurSurfaceCache {
    keys: [Option<BlurSurfaceKey>; 4],
    totals: BlurPassCounters,
}

impl BlurSurfaceCache {
    fn is_valid(&self, family: BlurFamily, key: BlurSurfaceKey) -> bool {
        self.keys[family as usize] == Some(key)
    }

    fn publish(&mut self, family: BlurFamily, key: BlurSurfaceKey) {
        self.keys[family as usize] = Some(key);
    }

    fn invalidate(&mut self, family: BlurFamily) {
        self.keys[family as usize] = None;
    }
}

impl BlurPassCounters {
    fn new(needs: BlurPassNeeds) -> Self {
        Self {
            families_requested: needs.flags().count_ones(),
            ..Self::default()
        }
    }

    fn record_family(&mut self, pixels: u64) {
        self.bind_groups += 2;
        self.dispatches += 2;
        self.pixels_processed += pixels * 2;
    }

    fn record_command_buffer(&mut self) {
        self.encoders += 1;
        self.submissions += 1;
    }
}

// Keep these Rust bindings in sync with src-tauri/src/shaders/shader.wgsl.
const MAIN_BINDING_INPUT_TEXTURE: u32 = 0;
const MAIN_BINDING_OUTPUT_TEXTURE: u32 = 1;
const MAIN_BINDING_ADJUSTMENTS: u32 = 2;
const MAIN_BINDING_MASK_TEXTURES: u32 = 3;
const MAIN_BINDING_LUT_TEXTURE: u32 = MAIN_BINDING_MASK_TEXTURES + MAX_MASK_BINDINGS;
const MAIN_BINDING_LUT_SAMPLER: u32 = MAIN_BINDING_LUT_TEXTURE + 1;
const MAIN_BINDING_SHARPNESS_BLUR: u32 = MAIN_BINDING_LUT_SAMPLER + 1;
const MAIN_BINDING_TONAL_BLUR: u32 = MAIN_BINDING_SHARPNESS_BLUR + 1;
const MAIN_BINDING_CLARITY_BLUR: u32 = MAIN_BINDING_TONAL_BLUR + 1;
const MAIN_BINDING_STRUCTURE_BLUR: u32 = MAIN_BINDING_CLARITY_BLUR + 1;
const MAIN_BINDING_FLARE_TEXTURE: u32 = MAIN_BINDING_STRUCTURE_BLUR + 1;
const MAIN_BINDING_FLARE_SAMPLER: u32 = MAIN_BINDING_FLARE_TEXTURE + 1;

// Keep these Rust bindings in sync with blur.wgsl and flare.wgsl.
const BLUR_BINDING_INPUT_TEXTURE: u32 = 0;
const BLUR_BINDING_OUTPUT_TEXTURE: u32 = 1;
const BLUR_BINDING_PARAMS: u32 = 2;
const FLARE_GROUP0_BINDING_INPUT_TEXTURE: u32 = 0;
const FLARE_GROUP0_BINDING_OUTPUT_TEXTURE: u32 = 1;
const FLARE_GROUP0_BINDING_PARAMS: u32 = 2;
const FLARE_GROUP0_BINDING_SAMPLER: u32 = 3;
const FLARE_GROUP1_BINDING_INPUT_TEXTURE: u32 = 0;
const FLARE_GROUP1_BINDING_OUTPUT_TEXTURE: u32 = 1;

#[derive(Clone, Copy, Debug)]
pub struct Roi {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

pub struct RenderRequest<'a> {
    pub adjustments: AllAdjustments,
    pub mask_bitmaps: &'a [ImageBuffer<Luma<u8>, Vec<u8>>],
    pub lut: Option<Arc<Lut>>,
    pub roi: Option<Roi>,
}

struct InputTextureRef<'a> {
    view: &'a wgpu::TextureView,
    identity: PreGpuImageIdentity,
    device_generation: u64,
}

fn to_rgba_f16(img: &DynamicImage) -> Vec<f16> {
    let rgba_f32 = img.to_rgba32f();
    rgba_f32.into_raw().into_iter().map(f16::from_f32).collect()
}

#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct BlurParams {
    radius: u32,
    tile_offset_x: u32,
    tile_offset_y: u32,
    input_width: u32,
    input_height: u32,
    _pad1: u32,
    _pad2: u32,
    _pad3: u32,
}

#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct FlareParams {
    amount: f32,
    is_raw: u32,
    exposure: f32,
    brightness: f32,
    contrast: f32,
    whites: f32,
    aspect_ratio: f32,
    _pad: f32,
}

pub struct GpuProcessor {
    context: GpuContext,
    generation: u64,
    blur_surface_cache: Mutex<BlurSurfaceCache>,
    blur_bgl: wgpu::BindGroupLayout,
    h_blur_pipeline: wgpu::ComputePipeline,
    v_blur_pipeline: wgpu::ComputePipeline,
    blur_params_buffers: [wgpu::Buffer; 4],

    flare_bgl_0: wgpu::BindGroupLayout,
    flare_bgl_1: wgpu::BindGroupLayout,
    flare_threshold_pipeline: wgpu::ComputePipeline,
    flare_ghosts_pipeline: wgpu::ComputePipeline,
    flare_params_buffer: wgpu::Buffer,
    flare_threshold_view: wgpu::TextureView,
    flare_ghosts_view: wgpu::TextureView,
    flare_final_view: wgpu::TextureView,
    flare_sampler: wgpu::Sampler,

    main_bgl: wgpu::BindGroupLayout,
    main_pipeline: wgpu::ComputePipeline,
    adjustments_buffer: wgpu::Buffer,
    dummy_blur_view: wgpu::TextureView,
    dummy_lut_view: wgpu::TextureView,
    dummy_lut_sampler: wgpu::Sampler,
    ping_pong_view: wgpu::TextureView,
    sharpness_blur_view: wgpu::TextureView,
    tonal_blur_view: wgpu::TextureView,
    clarity_blur_view: wgpu::TextureView,
    structure_blur_view: wgpu::TextureView,

    pub tile_output_texture: wgpu::Texture,
    pub tile_output_texture_view: wgpu::TextureView,
    pub working_texture: wgpu::Texture,
    pub working_texture_view: wgpu::TextureView,
    pub output_texture: wgpu::Texture,
    pub output_texture_view: wgpu::TextureView,
}

const FLARE_MAP_SIZE: u32 = 512;

impl GpuProcessor {
    pub fn new(context: GpuContext, max_width: u32, max_height: u32) -> Result<Self, String> {
        let device = &context.device;

        let blur_shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Blur Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/blur.wgsl").into()),
        });

        let blur_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Blur BGL"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: BLUR_BINDING_INPUT_TEXTURE,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: BLUR_BINDING_OUTPUT_TEXTURE,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba16Float,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: BLUR_BINDING_PARAMS,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let blur_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Blur Pipeline Layout"),
            bind_group_layouts: &[Some(&blur_bgl)],
            immediate_size: 0,
        });

        let h_blur_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Horizontal Blur Pipeline"),
            layout: Some(&blur_pipeline_layout),
            module: &blur_shader_module,
            entry_point: Some("horizontal_blur"),
            compilation_options: Default::default(),
            cache: None,
        });

        let v_blur_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Vertical Blur Pipeline"),
            layout: Some(&blur_pipeline_layout),
            module: &blur_shader_module,
            entry_point: Some("vertical_blur"),
            compilation_options: Default::default(),
            cache: None,
        });

        let blur_params_buffers = std::array::from_fn(|index| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(match index {
                    0 => "Sharpness Blur Params",
                    1 => "Tonal Blur Params",
                    2 => "Clarity Blur Params",
                    _ => "Structure Blur Params",
                }),
                size: std::mem::size_of::<BlurParams>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        });

        let flare_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Flare Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/flare.wgsl").into()),
        });

        let flare_bgl_0 = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Flare BGL 0"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: FLARE_GROUP0_BINDING_INPUT_TEXTURE,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: FLARE_GROUP0_BINDING_OUTPUT_TEXTURE,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba16Float,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: FLARE_GROUP0_BINDING_PARAMS,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: FLARE_GROUP0_BINDING_SAMPLER,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let flare_bgl_1 = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Flare BGL 1"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: FLARE_GROUP1_BINDING_INPUT_TEXTURE,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: FLARE_GROUP1_BINDING_OUTPUT_TEXTURE,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba16Float,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
            ],
        });

        let flare_threshold_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Flare Threshold Layout"),
                bind_group_layouts: &[Some(&flare_bgl_0)],
                immediate_size: 0,
            });

        let flare_ghosts_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Flare Ghosts Layout"),
            bind_group_layouts: &[Some(&flare_bgl_0), Some(&flare_bgl_1)],
            immediate_size: 0,
        });

        let flare_threshold_pipeline =
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("Flare Threshold Pipeline"),
                layout: Some(&flare_threshold_layout),
                module: &flare_shader,
                entry_point: Some("threshold_main"),
                compilation_options: Default::default(),
                cache: None,
            });

        let flare_ghosts_pipeline =
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("Flare Ghosts Pipeline"),
                layout: Some(&flare_ghosts_layout),
                module: &flare_shader,
                entry_point: Some("ghosts_main"),
                compilation_options: Default::default(),
                cache: None,
            });

        let flare_params_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Flare Params Buffer"),
            size: std::mem::size_of::<FlareParams>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let flare_tex_desc = wgpu::TextureDescriptor {
            label: Some("Flare Tex"),
            size: wgpu::Extent3d {
                width: FLARE_MAP_SIZE,
                height: FLARE_MAP_SIZE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::STORAGE_BINDING,
            view_formats: &[],
        };

        let flare_threshold_texture = device.create_texture(&flare_tex_desc);
        let flare_threshold_view = flare_threshold_texture.create_view(&Default::default());
        let flare_ghosts_texture = device.create_texture(&flare_tex_desc);
        let flare_ghosts_view = flare_ghosts_texture.create_view(&Default::default());
        let flare_final_texture = device.create_texture(&flare_tex_desc);
        let flare_final_view = flare_final_texture.create_view(&Default::default());

        let flare_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Flare Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Image Processing Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/shader.wgsl").into()),
        });

        let mut bind_group_layout_entries = vec![
            wgpu::BindGroupLayoutEntry {
                binding: MAIN_BINDING_INPUT_TEXTURE,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: MAIN_BINDING_OUTPUT_TEXTURE,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::StorageTexture {
                    access: wgpu::StorageTextureAccess::WriteOnly,
                    format: GPU_OUTPUT_TEXTURE_FORMAT,
                    view_dimension: wgpu::TextureViewDimension::D2,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: MAIN_BINDING_ADJUSTMENTS,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: true },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
        ];

        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: MAIN_BINDING_MASK_TEXTURES,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2Array,
                multisampled: false,
            },
            count: None,
        });

        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: MAIN_BINDING_LUT_TEXTURE,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D3,
                multisampled: false,
            },
            count: None,
        });
        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: MAIN_BINDING_LUT_SAMPLER,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::NonFiltering),
            count: None,
        });

        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: MAIN_BINDING_SHARPNESS_BLUR,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: MAIN_BINDING_TONAL_BLUR,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: MAIN_BINDING_CLARITY_BLUR,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: MAIN_BINDING_STRUCTURE_BLUR,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });

        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: MAIN_BINDING_FLARE_TEXTURE,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: MAIN_BINDING_FLARE_SAMPLER,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            count: None,
        });

        let main_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Main BGL"),
            entries: &bind_group_layout_entries,
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Pipeline Layout"),
            bind_group_layouts: &[Some(&main_bgl)],
            immediate_size: 0,
        });

        let main_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Compute Pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader_module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        let adjustments_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Adjustments Buffer"),
            size: std::mem::size_of::<AllAdjustments>() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let dummy_blur_view = create_dummy_rgba16f_texture_view(device);
        let dummy_lut_view = create_dummy_lut_texture_view(device);
        let dummy_lut_sampler = device.create_sampler(&wgpu::SamplerDescriptor::default());

        let max_tile_size = wgpu::Extent3d {
            width: max_width,
            height: max_height,
            depth_or_array_layers: 1,
        };

        let blur_texture_usage =
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::STORAGE_BINDING;
        let (_, ping_pong_view) = create_rgba16f_texture_with_view(
            device,
            "Ping Pong Texture",
            max_tile_size,
            blur_texture_usage,
        );
        let (_, sharpness_blur_view) = create_rgba16f_texture_with_view(
            device,
            "Sharpness Blur Texture",
            max_tile_size,
            blur_texture_usage,
        );
        let (_, tonal_blur_view) = create_rgba16f_texture_with_view(
            device,
            "Tonal Blur Texture",
            max_tile_size,
            blur_texture_usage,
        );
        let (_, clarity_blur_view) = create_rgba16f_texture_with_view(
            device,
            "Clarity Blur Texture",
            max_tile_size,
            blur_texture_usage,
        );
        let (_, structure_blur_view) = create_rgba16f_texture_with_view(
            device,
            "Structure Blur Texture",
            max_tile_size,
            blur_texture_usage,
        );

        let (tile_output_texture, tile_output_texture_view) = create_rgba16f_texture_with_view(
            device,
            "Tile Output Texture",
            max_tile_size,
            blur_texture_usage | wgpu::TextureUsages::COPY_SRC,
        );

        let display_output_texture_usage =
            blur_texture_usage | wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::COPY_SRC;
        let (working_texture, working_texture_view) = create_rgba16f_texture_with_view(
            device,
            "Working Output Texture",
            max_tile_size,
            display_output_texture_usage,
        );
        let (output_texture, output_texture_view) = create_rgba16f_texture_with_view(
            device,
            "Full Output Texture",
            max_tile_size,
            display_output_texture_usage,
        );

        Ok(Self {
            context,
            generation: NEXT_PROCESSOR_GENERATION.fetch_add(1, Ordering::Relaxed),
            blur_surface_cache: Mutex::new(BlurSurfaceCache::default()),
            blur_bgl,
            h_blur_pipeline,
            v_blur_pipeline,
            blur_params_buffers,
            flare_bgl_0,
            flare_bgl_1,
            flare_threshold_pipeline,
            flare_ghosts_pipeline,
            flare_params_buffer,
            flare_threshold_view,
            flare_ghosts_view,
            flare_final_view,
            flare_sampler,
            main_bgl,
            main_pipeline,
            adjustments_buffer,
            dummy_blur_view,
            dummy_lut_view,
            dummy_lut_sampler,
            ping_pong_view,
            sharpness_blur_view,
            tonal_blur_view,
            clarity_blur_view,
            structure_blur_view,
            tile_output_texture,
            tile_output_texture_view,
            working_texture,
            working_texture_view,
            output_texture,
            output_texture_view,
        })
    }

    fn run(
        &self,
        input: InputTextureRef<'_>,
        width: u32,
        height: u32,
        request: RenderRequest,
        skip_cpu_readback: bool,
        output_to_display: bool,
    ) -> Result<(Vec<u8>, u32, u32, u32, u32), String> {
        let device = &self.context.device;
        let queue = &self.context.queue;
        let input_texture_view = input.view;
        let scale = (width.min(height) as f32) / 1080.0;

        let bounds = request.roi.unwrap_or(Roi {
            x: 0,
            y: 0,
            width,
            height,
        });
        let out_width = bounds.width;
        let out_height = bounds.height;
        let mask_layer_count = request.mask_bitmaps.len().clamp(2, MAX_MASKS) as u32;
        let full_texture_size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: mask_layer_count,
        };
        let buffer_size = (width as usize) * (height as usize) * (mask_layer_count as usize);
        let mut mask_texture_data = Vec::with_capacity(buffer_size);
        if request.mask_bitmaps.is_empty() {
            mask_texture_data.resize(buffer_size, 0);
        } else {
            for mask_bitmap in request.mask_bitmaps.iter().take(MAX_MASKS) {
                mask_texture_data.extend_from_slice(mask_bitmap.as_raw());
            }
            if mask_texture_data.len() < buffer_size {
                mask_texture_data.resize(buffer_size, 0);
            }
        }
        let mask_texture = device.create_texture_with_data(
            queue,
            &wgpu::TextureDescriptor {
                label: Some("Full Mask Texture Array"),
                size: full_texture_size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::R8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            },
            TextureDataOrder::MipMajor,
            &mask_texture_data,
        );
        let mask_texture_view = mask_texture.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });

        let (lut_texture_view, lut_sampler) = if let Some(lut_arc) = &request.lut {
            let lut_data = &lut_arc.data;
            let size = lut_arc.size;
            let mut rgba_lut_data_f16 = Vec::with_capacity(lut_data.len() / 3 * 4);
            for chunk in lut_data.chunks_exact(3) {
                rgba_lut_data_f16.push(f16::from_f32(chunk[0]));
                rgba_lut_data_f16.push(f16::from_f32(chunk[1]));
                rgba_lut_data_f16.push(f16::from_f32(chunk[2]));
                rgba_lut_data_f16.push(f16::ONE);
            }
            let lut_texture = device.create_texture_with_data(
                queue,
                &wgpu::TextureDescriptor {
                    label: Some("LUT 3D Texture"),
                    size: wgpu::Extent3d {
                        width: size,
                        height: size,
                        depth_or_array_layers: size,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D3,
                    format: wgpu::TextureFormat::Rgba16Float,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                },
                TextureDataOrder::MipMajor,
                bytemuck::cast_slice(&rgba_lut_data_f16),
            );
            let view = lut_texture.create_view(&Default::default());
            let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
                address_mode_u: wgpu::AddressMode::ClampToEdge,
                address_mode_v: wgpu::AddressMode::ClampToEdge,
                address_mode_w: wgpu::AddressMode::ClampToEdge,
                mag_filter: wgpu::FilterMode::Nearest,
                min_filter: wgpu::FilterMode::Nearest,
                ..Default::default()
            });
            (view, sampler)
        } else {
            (self.dummy_lut_view.clone(), self.dummy_lut_sampler.clone())
        };

        let mut adjustments = request.adjustments;
        let graph = compile_gpu_render_graph(
            &adjustments,
            request.lut.is_some(),
            request.mask_bitmaps.len(),
            width,
            height,
        );
        let blur_pass_needs = resolve_blur_pass_needs(&adjustments);
        #[cfg(test)]
        let blur_pass_needs = if FORCE_ALL_BLUR_PASSES.load(Ordering::Relaxed) {
            BlurPassNeeds {
                sharpness: true,
                tonal: true,
                clarity: true,
                structure: true,
            }
        } else {
            blur_pass_needs
        };
        adjustments.blur_pass_flags = blur_pass_needs.flags();
        let mut blur_counters = BlurPassCounters::new(blur_pass_needs);
        let mut flare_command_buffer = None;
        if adjustments.global.flare_amount > 0.0 {
            let mut encoder = device.create_command_encoder(&Default::default());

            let aspect_ratio = if height > 0 {
                width as f32 / height as f32
            } else {
                1.0
            };
            let f_params = FlareParams {
                amount: adjustments.global.flare_amount,
                is_raw: adjustments.global.is_raw_image,
                exposure: adjustments.global.exposure,
                brightness: adjustments.global.brightness,
                contrast: adjustments.global.contrast,
                whites: adjustments.global.whites,
                aspect_ratio,
                _pad: 0.0,
            };
            queue.write_buffer(&self.flare_params_buffer, 0, bytemuck::bytes_of(&f_params));

            let bg0 = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Flare BG0"),
                layout: &self.flare_bgl_0,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: FLARE_GROUP0_BINDING_INPUT_TEXTURE,
                        resource: wgpu::BindingResource::TextureView(input_texture_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: FLARE_GROUP0_BINDING_OUTPUT_TEXTURE,
                        resource: wgpu::BindingResource::TextureView(&self.flare_threshold_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: FLARE_GROUP0_BINDING_PARAMS,
                        resource: self.flare_params_buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: FLARE_GROUP0_BINDING_SAMPLER,
                        resource: wgpu::BindingResource::Sampler(&self.flare_sampler),
                    },
                ],
            });

            {
                let mut cpass = encoder.begin_compute_pass(&Default::default());
                cpass.set_pipeline(&self.flare_threshold_pipeline);
                cpass.set_bind_group(0, &bg0, &[]);
                cpass.dispatch_workgroups(FLARE_MAP_SIZE / 16, FLARE_MAP_SIZE / 16, 1);
            }

            let bg0_ghosts = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Flare BG0 Ghosts"),
                layout: &self.flare_bgl_0,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: FLARE_GROUP0_BINDING_INPUT_TEXTURE,
                        resource: wgpu::BindingResource::TextureView(input_texture_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: FLARE_GROUP0_BINDING_OUTPUT_TEXTURE,
                        resource: wgpu::BindingResource::TextureView(&self.flare_final_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: FLARE_GROUP0_BINDING_PARAMS,
                        resource: self.flare_params_buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: FLARE_GROUP0_BINDING_SAMPLER,
                        resource: wgpu::BindingResource::Sampler(&self.flare_sampler),
                    },
                ],
            });

            let bg1 = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Flare BG1"),
                layout: &self.flare_bgl_1,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: FLARE_GROUP1_BINDING_INPUT_TEXTURE,
                        resource: wgpu::BindingResource::TextureView(&self.flare_threshold_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: FLARE_GROUP1_BINDING_OUTPUT_TEXTURE,
                        resource: wgpu::BindingResource::TextureView(&self.flare_ghosts_view),
                    },
                ],
            });

            {
                let mut cpass = encoder.begin_compute_pass(&Default::default());
                cpass.set_pipeline(&self.flare_ghosts_pipeline);
                cpass.set_bind_group(0, &bg0_ghosts, &[]);
                cpass.set_bind_group(1, &bg1, &[]);
                cpass.dispatch_workgroups(FLARE_MAP_SIZE / 16, FLARE_MAP_SIZE / 16, 1);
            }

            flare_command_buffer = Some(encoder.finish());
        }

        const TILE_SIZE: u32 = 2048;
        let tile_overlap = graph.tile_halo;

        let mut final_pixels = vec![
            0u8;
            if skip_cpu_readback {
                0
            } else {
                (out_width * out_height * GPU_OUTPUT_BYTES_PER_PIXEL) as usize
            }
        ];
        let mut cpu_encode_time = Duration::ZERO;
        let mut command_buffer_count = u32::from(flare_command_buffer.is_some());

        let start_tile_x = bounds.x / TILE_SIZE;
        let start_tile_y = bounds.y / TILE_SIZE;
        let end_tile_x = (bounds.x + bounds.width).div_ceil(TILE_SIZE);
        let end_tile_y = (bounds.y + bounds.height).div_ceil(TILE_SIZE);

        for tile_y in start_tile_y..end_tile_y {
            for tile_x in start_tile_x..end_tile_x {
                let x_start_unclamped = tile_x * TILE_SIZE;
                let y_start_unclamped = tile_y * TILE_SIZE;

                let x_start = x_start_unclamped.max(bounds.x);
                let y_start = y_start_unclamped.max(bounds.y);
                let x_end = (x_start_unclamped + TILE_SIZE)
                    .min(bounds.x + bounds.width)
                    .min(width);
                let y_end = (y_start_unclamped + TILE_SIZE)
                    .min(bounds.y + bounds.height)
                    .min(height);

                let tile_width = x_end - x_start;
                let tile_height = y_end - y_start;

                let input_x_start = x_start.saturating_sub(tile_overlap);
                let input_y_start = y_start.saturating_sub(tile_overlap);
                let input_x_end = (x_end + tile_overlap).min(width);
                let input_y_end = (y_end + tile_overlap).min(height);
                let input_width = input_x_end - input_x_start;
                let input_height = input_y_end - input_y_start;

                let input_texture_size = wgpu::Extent3d {
                    width: input_width,
                    height: input_height,
                    depth_or_array_layers: 1,
                };

                let cache_one_tile = start_tile_x == 0
                    && start_tile_y == 0
                    && end_tile_x == 1
                    && end_tile_y == 1
                    && bounds.x == 0
                    && bounds.y == 0
                    && bounds.width == width
                    && bounds.height == height;
                #[cfg(test)]
                let cache_one_tile =
                    cache_one_tile && !FORCE_DISABLE_BLUR_CACHE.load(Ordering::Relaxed);

                let encode_started = Instant::now();
                let mut main_encoder =
                    device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: Some("GPU render graph encoder"),
                    });
                let mut run_blur = |family: BlurFamily,
                                    base_radius: f32,
                                    output_view: &wgpu::TextureView|
                 -> bool {
                    let radius = (base_radius * scale).ceil().max(1.0) as u32;
                    if radius == 0 {
                        return false;
                    }

                    let key = BlurSurfaceKey {
                        processor_generation: self.generation,
                        device_generation: input.device_generation,
                        input_identity: input.identity,
                        input_width: width,
                        input_height: height,
                        tile_x,
                        tile_y,
                        tile_width,
                        tile_height,
                        input_x_start,
                        input_y_start,
                        input_width_with_overlap: input_width,
                        input_height_with_overlap: input_height,
                        radius_px: radius,
                        blur_abi_version: BLUR_ABI_VERSION,
                    };
                    if cache_one_tile
                        && self
                            .blur_surface_cache
                            .lock()
                            .unwrap()
                            .is_valid(family, key)
                    {
                        blur_counters.cache_hits += 1;
                        return true;
                    }
                    if cache_one_tile {
                        blur_counters.cache_misses += 1;
                    } else {
                        self.blur_surface_cache.lock().unwrap().invalidate(family);
                    }

                    let params = BlurParams {
                        radius,
                        tile_offset_x: input_x_start,
                        tile_offset_y: input_y_start,
                        input_width,
                        input_height,
                        _pad1: 0,
                        _pad2: 0,
                        _pad3: 0,
                    };
                    let params_buffer = &self.blur_params_buffers[family as usize];
                    queue.write_buffer(params_buffer, 0, bytemuck::bytes_of(&params));

                    let h_blur_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("H-Blur BG"),
                        layout: &self.blur_bgl,
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: BLUR_BINDING_INPUT_TEXTURE,
                                resource: wgpu::BindingResource::TextureView(input_texture_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: BLUR_BINDING_OUTPUT_TEXTURE,
                                resource: wgpu::BindingResource::TextureView(&self.ping_pong_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: BLUR_BINDING_PARAMS,
                                resource: params_buffer.as_entire_binding(),
                            },
                        ],
                    });

                    {
                        let mut cpass = main_encoder.begin_compute_pass(&Default::default());
                        cpass.set_pipeline(&self.h_blur_pipeline);
                        cpass.set_bind_group(0, &h_blur_bg, &[]);
                        cpass.dispatch_workgroups(input_width.div_ceil(256), input_height, 1);
                    }

                    let v_blur_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("V-Blur BG"),
                        layout: &self.blur_bgl,
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: BLUR_BINDING_INPUT_TEXTURE,
                                resource: wgpu::BindingResource::TextureView(&self.ping_pong_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: BLUR_BINDING_OUTPUT_TEXTURE,
                                resource: wgpu::BindingResource::TextureView(output_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: BLUR_BINDING_PARAMS,
                                resource: params_buffer.as_entire_binding(),
                            },
                        ],
                    });

                    {
                        let mut cpass = main_encoder.begin_compute_pass(&Default::default());
                        cpass.set_pipeline(&self.v_blur_pipeline);
                        cpass.set_bind_group(0, &v_blur_bg, &[]);
                        cpass.dispatch_workgroups(input_width, input_height.div_ceil(256), 1);
                    }

                    if cache_one_tile {
                        self.blur_surface_cache.lock().unwrap().publish(family, key);
                    }
                    blur_counters.record_family(u64::from(input_width) * u64::from(input_height));
                    true
                };

                let did_create_sharpness_blur = blur_pass_needs.sharpness
                    && run_blur(BlurFamily::Sharpness, 1.0, &self.sharpness_blur_view);
                let did_create_tonal_blur = blur_pass_needs.tonal
                    && run_blur(BlurFamily::Tonal, 3.5, &self.tonal_blur_view);
                let did_create_clarity_blur = blur_pass_needs.clarity
                    && run_blur(BlurFamily::Clarity, 8.0, &self.clarity_blur_view);
                let did_create_structure_blur = blur_pass_needs.structure
                    && run_blur(BlurFamily::Structure, 40.0, &self.structure_blur_view);

                let mut tile_adjustments = adjustments;
                tile_adjustments.tile_offset_x = input_x_start;
                tile_adjustments.tile_offset_y = input_y_start;
                queue.write_buffer(
                    &self.adjustments_buffer,
                    0,
                    bytemuck::bytes_of(&tile_adjustments),
                );

                let mut bind_group_entries = vec![
                    wgpu::BindGroupEntry {
                        binding: MAIN_BINDING_INPUT_TEXTURE,
                        resource: wgpu::BindingResource::TextureView(input_texture_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: MAIN_BINDING_OUTPUT_TEXTURE,
                        resource: wgpu::BindingResource::TextureView(
                            &self.tile_output_texture_view,
                        ),
                    },
                    wgpu::BindGroupEntry {
                        binding: MAIN_BINDING_ADJUSTMENTS,
                        resource: self.adjustments_buffer.as_entire_binding(),
                    },
                ];
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: MAIN_BINDING_MASK_TEXTURES,
                    resource: wgpu::BindingResource::TextureView(&mask_texture_view),
                });
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: MAIN_BINDING_LUT_TEXTURE,
                    resource: wgpu::BindingResource::TextureView(&lut_texture_view),
                });
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: MAIN_BINDING_LUT_SAMPLER,
                    resource: wgpu::BindingResource::Sampler(&lut_sampler),
                });

                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: MAIN_BINDING_SHARPNESS_BLUR,
                    resource: wgpu::BindingResource::TextureView(if did_create_sharpness_blur {
                        &self.sharpness_blur_view
                    } else {
                        &self.dummy_blur_view
                    }),
                });
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: MAIN_BINDING_TONAL_BLUR,
                    resource: wgpu::BindingResource::TextureView(if did_create_tonal_blur {
                        &self.tonal_blur_view
                    } else {
                        &self.dummy_blur_view
                    }),
                });
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: MAIN_BINDING_CLARITY_BLUR,
                    resource: wgpu::BindingResource::TextureView(if did_create_clarity_blur {
                        &self.clarity_blur_view
                    } else {
                        &self.dummy_blur_view
                    }),
                });
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: MAIN_BINDING_STRUCTURE_BLUR,
                    resource: wgpu::BindingResource::TextureView(if did_create_structure_blur {
                        &self.structure_blur_view
                    } else {
                        &self.dummy_blur_view
                    }),
                });

                let use_flare = adjustments.global.flare_amount > 0.0;
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: MAIN_BINDING_FLARE_TEXTURE,
                    resource: wgpu::BindingResource::TextureView(if use_flare {
                        &self.flare_ghosts_view
                    } else {
                        &self.dummy_blur_view
                    }),
                });
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: MAIN_BINDING_FLARE_SAMPLER,
                    resource: wgpu::BindingResource::Sampler(&self.flare_sampler),
                });

                let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("Tile Bind Group"),
                    layout: &self.main_bgl,
                    entries: &bind_group_entries,
                });

                {
                    let mut compute_pass = main_encoder.begin_compute_pass(&Default::default());
                    compute_pass.set_pipeline(&self.main_pipeline);
                    compute_pass.set_bind_group(0, &bind_group, &[]);
                    compute_pass.dispatch_workgroups(
                        input_width.div_ceil(8),
                        input_height.div_ceil(8),
                        1,
                    );
                }

                let crop_x_start = x_start - input_x_start;
                let crop_y_start = y_start - input_y_start;

                if output_to_display {
                    main_encoder.copy_texture_to_texture(
                        wgpu::TexelCopyTextureInfo {
                            texture: &self.tile_output_texture,
                            mip_level: 0,
                            origin: wgpu::Origin3d {
                                x: crop_x_start,
                                y: crop_y_start,
                                z: 0,
                            },
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::TexelCopyTextureInfo {
                            texture: &self.working_texture,
                            mip_level: 0,
                            origin: wgpu::Origin3d {
                                x: x_start,
                                y: y_start,
                                z: 0,
                            },
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::Extent3d {
                            width: tile_width,
                            height: tile_height,
                            depth_or_array_layers: 1,
                        },
                    );
                }

                let tile_command_buffer = main_encoder.finish();
                queue.submit(
                    flare_command_buffer
                        .take()
                        .into_iter()
                        .chain(std::iter::once(tile_command_buffer)),
                );
                blur_counters.record_command_buffer();
                command_buffer_count += 1;
                cpu_encode_time += encode_started.elapsed();

                if !skip_cpu_readback {
                    let processed_tile_data = read_texture_data_roi_with_bytes_per_pixel(
                        device,
                        queue,
                        &self.tile_output_texture,
                        wgpu::Origin3d::ZERO,
                        input_texture_size,
                        GPU_OUTPUT_BYTES_PER_PIXEL,
                    )?;

                    for row in 0..tile_height {
                        let final_y = y_start + row - bounds.y;
                        let final_x = x_start - bounds.x;
                        let final_row_offset = (final_y * out_width + final_x) as usize
                            * GPU_OUTPUT_BYTES_PER_PIXEL as usize;
                        let source_y = crop_y_start + row;
                        let source_row_offset = (source_y * input_width + crop_x_start) as usize
                            * GPU_OUTPUT_BYTES_PER_PIXEL as usize;
                        let copy_bytes = (tile_width * GPU_OUTPUT_BYTES_PER_PIXEL) as usize;

                        final_pixels[final_row_offset..final_row_offset + copy_bytes]
                            .copy_from_slice(
                                &processed_tile_data
                                    [source_row_offset..source_row_offset + copy_bytes],
                            );
                    }
                }
            }
        }

        {
            let mut cache = self.blur_surface_cache.lock().unwrap();
            cache.totals.families_requested += blur_counters.families_requested;
            cache.totals.encoders += blur_counters.encoders;
            cache.totals.bind_groups += blur_counters.bind_groups;
            cache.totals.dispatches += blur_counters.dispatches;
            cache.totals.submissions += blur_counters.submissions;
            cache.totals.pixels_processed += blur_counters.pixels_processed;
            cache.totals.cache_hits += blur_counters.cache_hits;
            cache.totals.cache_misses += blur_counters.cache_misses;
        }
        log::debug!("blur passes: needs={blur_pass_needs:?} counters={blur_counters:?}");
        let receipt = GpuExecutionReceipt {
            graph_fingerprint: graph.fingerprint,
            stages: graph.flags,
            blur_dispatch_count: blur_counters.dispatches,
            render_pass_count: blur_counters.dispatches + blur_counters.submissions,
            command_buffer_count,
            queue_submit_count: blur_counters.submissions,
            estimated_peak_resource_bytes: graph.estimated_peak_resource_bytes,
            cpu_encode_time,
        };
        log::debug!("GPU execution receipt: {receipt:?}");

        Ok((final_pixels, out_width, out_height, bounds.x, bounds.y))
    }
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default, clippy::items_after_test_module)]
mod blur_pass_tests {
    use super::*;

    #[cfg(feature = "tauri-test")]
    static GPU_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn surface_key() -> BlurSurfaceKey {
        BlurSurfaceKey {
            processor_generation: 1,
            device_generation: 2,
            input_identity: PreGpuImageIdentity {
                source_revision: 3,
                stage_revision: 4,
                pixel_fingerprint: 5,
                width: 1920,
                height: 1080,
                precision_abi: PRE_GPU_PRECISION_ABI_RGBA16F_V1,
            },
            input_width: 1920,
            input_height: 1080,
            tile_x: 0,
            tile_y: 0,
            tile_width: 1920,
            tile_height: 1080,
            input_x_start: 0,
            input_y_start: 0,
            input_width_with_overlap: 1920,
            input_height_with_overlap: 1080,
            radius_px: 8,
            blur_abi_version: BLUR_ABI_VERSION,
        }
    }

    fn needs(adjustments: AllAdjustments) -> BlurPassNeeds {
        resolve_blur_pass_needs(&adjustments)
    }

    #[test]
    fn default_and_exposure_only_need_no_blurs() {
        assert_eq!(needs(AllAdjustments::default()), BlurPassNeeds::default());

        let mut adjustments = AllAdjustments::default();
        adjustments.global.exposure = 1.0;
        assert_eq!(needs(adjustments), BlurPassNeeds::default());
    }

    #[test]
    fn graph_compiler_emits_versioned_active_products_and_halo() {
        let exposure = compile_gpu_render_graph(&AllAdjustments::default(), false, 0, 3840, 2160);
        assert_eq!(exposure.graph_version, GPU_RENDER_GRAPH_VERSION);
        assert_eq!(exposure.flags, GpuStageFlags::MAIN_ADJUST);
        assert!(exposure.blur_products.is_empty());
        assert_eq!(exposure.tile_halo, 0);

        let mut adjustments = AllAdjustments::default();
        adjustments.global.contrast = 0.2;
        adjustments.global.highlights = -0.1;
        adjustments.global.clarity = 0.3;
        adjustments.mask_count = 1;
        let graph = compile_gpu_render_graph(&adjustments, true, 1, 3840, 2160);
        assert_eq!(
            graph.flags,
            GpuStageFlags::MAIN_ADJUST
                | GpuStageFlags::BLUR_TONAL
                | GpuStageFlags::BLUR_CLARITY
                | GpuStageFlags::LUT
                | GpuStageFlags::MASKS
        );
        assert_eq!(
            graph
                .blur_products
                .iter()
                .map(|product| product.semantic)
                .collect::<Vec<_>>(),
            vec![BlurSemantic::Tonal, BlurSemantic::Clarity]
        );
        assert_eq!(graph.tile_halo, 16);
        assert!(graph.estimated_peak_resource_bytes > 0);
        assert_ne!(graph.fingerprint, exposure.fingerprint);
    }

    #[test]
    fn graph_compiler_deduplicates_consumers_and_scales_largest_radius() {
        let mut adjustments = AllAdjustments::default();
        adjustments.global.structure = 0.2;
        adjustments.global.dehaze = 0.3;
        adjustments.global.glow_amount = 0.4;
        let graph = compile_gpu_render_graph(&adjustments, false, 0, 1920, 1080);
        assert_eq!(graph.blur_products.len(), 1);
        assert_eq!(graph.blur_products[0].semantic, BlurSemantic::Structure);
        assert_eq!(graph.tile_halo, 40);
    }

    #[test]
    fn pre_gpu_identity_tracks_source_stage_pixels_dimensions_and_precision() {
        use image::{ImageBuffer, Rgba};

        let image = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(4, 3, Rgba([1, 2, 3, 4])));
        let baseline = PreGpuImageIdentity::from_image(&image, 10, 20);
        assert_eq!(baseline, PreGpuImageIdentity::from_image(&image, 10, 20));
        assert_ne!(baseline, PreGpuImageIdentity::from_image(&image, 11, 20));
        assert_ne!(baseline, PreGpuImageIdentity::from_image(&image, 10, 21));

        let changed_pixel =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(4, 3, Rgba([2, 2, 3, 4])));
        let changed_dimensions =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(5, 3, Rgba([1, 2, 3, 4])));
        assert_ne!(
            baseline,
            PreGpuImageIdentity::from_image(&changed_pixel, 10, 20)
        );
        assert_ne!(
            baseline,
            PreGpuImageIdentity::from_image(&changed_dimensions, 10, 20)
        );
        assert_eq!(baseline.precision_abi, PRE_GPU_PRECISION_ABI_RGBA16F_V1);
    }

    #[test]
    fn global_consumers_activate_their_blur_family() {
        let mut sharpness = AllAdjustments::default();
        sharpness.global.sharpness = -0.1;
        assert!(needs(sharpness).sharpness);

        for tonal in [
            |a: &mut AllAdjustments| a.global.contrast = 0.1,
            |a: &mut AllAdjustments| a.global.highlights = -0.1,
            |a: &mut AllAdjustments| a.global.shadows = 0.1,
            |a: &mut AllAdjustments| a.global.whites = -0.1,
            |a: &mut AllAdjustments| a.global.blacks = 0.1,
        ] {
            let mut adjustments = AllAdjustments::default();
            tonal(&mut adjustments);
            assert!(needs(adjustments).tonal);
        }

        for clarity in [
            |a: &mut AllAdjustments| a.global.clarity = -0.1,
            |a: &mut AllAdjustments| a.global.centré = 0.1,
            |a: &mut AllAdjustments| a.global.halation_amount = 0.1,
        ] {
            let mut adjustments = AllAdjustments::default();
            clarity(&mut adjustments);
            assert!(needs(adjustments).clarity);
        }

        for structure in [
            |a: &mut AllAdjustments| a.global.structure = -0.1,
            |a: &mut AllAdjustments| a.global.dehaze = 0.1,
            |a: &mut AllAdjustments| a.global.glow_amount = 0.1,
        ] {
            let mut adjustments = AllAdjustments::default();
            structure(&mut adjustments);
            assert!(needs(adjustments).structure);
        }
    }

    #[test]
    fn mask_consumers_activate_only_within_mask_count() {
        let mut adjustments = AllAdjustments::default();
        adjustments.mask_count = 4;
        adjustments.mask_adjustments[0].sharpness = 0.01;
        adjustments.mask_adjustments[1].highlights = -0.1;
        adjustments.mask_adjustments[2].halation_amount = 0.1;
        adjustments.mask_adjustments[3].dehaze = -0.1;
        assert_eq!(
            needs(adjustments),
            BlurPassNeeds {
                sharpness: true,
                tonal: true,
                clarity: true,
                structure: true,
            }
        );

        adjustments.mask_count = 0;
        assert_eq!(needs(adjustments), BlurPassNeeds::default());
    }

    #[test]
    fn mask_activation_matches_shader_thresholds_and_sign_rules() {
        let mut adjustments = AllAdjustments::default();
        adjustments.mask_count = 1;

        adjustments.mask_adjustments[0].sharpness = 0.001;
        assert!(!needs(adjustments).sharpness);
        adjustments.mask_adjustments[0].sharpness = -0.00101;
        assert!(needs(adjustments).sharpness);

        adjustments.mask_adjustments[0] = Default::default();
        adjustments.mask_adjustments[0].halation_amount = -1.0;
        adjustments.mask_adjustments[0].glow_amount = -1.0;
        let resolved = needs(adjustments);
        assert!(!resolved.clarity);
        assert!(!resolved.structure);
    }

    #[test]
    fn combined_consumers_union_to_one_pass_per_family() {
        let mut adjustments = AllAdjustments::default();
        adjustments.global.contrast = 0.1;
        adjustments.global.highlights = 0.2;
        adjustments.global.clarity = 0.1;
        adjustments.mask_count = 1;
        adjustments.mask_adjustments[0].clarity = -0.2;

        let resolved = needs(adjustments);
        assert_eq!(resolved.flags(), BLUR_FLAG_TONAL | BLUR_FLAG_CLARITY);

        let mut counters = BlurPassCounters::new(resolved);
        counters.record_family(100);
        counters.record_family(100);
        assert_eq!(counters.families_requested, 2);
        counters.record_command_buffer();
        assert_eq!(counters.encoders, 1);
        assert_eq!(counters.bind_groups, 4);
        assert_eq!(counters.dispatches, 4);
        assert_eq!(counters.submissions, 1);
        assert_eq!(counters.pixels_processed, 400);
    }

    #[test]
    fn blur_surfaces_reuse_independently_and_key_identity_lifecycle() {
        let key = surface_key();
        let mut cache = BlurSurfaceCache::default();
        cache.publish(BlurFamily::Tonal, key);
        assert!(cache.is_valid(BlurFamily::Tonal, key));
        assert!(!cache.is_valid(BlurFamily::Clarity, key));

        cache.publish(BlurFamily::Clarity, key);
        cache.invalidate(BlurFamily::Clarity);
        assert!(cache.is_valid(BlurFamily::Tonal, key));
        assert!(!cache.is_valid(BlurFamily::Clarity, key));

        for variant in [
            BlurSurfaceKey {
                processor_generation: 9,
                ..key
            },
            BlurSurfaceKey {
                device_generation: 9,
                ..key
            },
            BlurSurfaceKey {
                input_identity: PreGpuImageIdentity {
                    stage_revision: 9,
                    ..key.input_identity
                },
                ..key
            },
            BlurSurfaceKey {
                tile_width: 1024,
                ..key
            },
            BlurSurfaceKey {
                input_x_start: 4,
                ..key
            },
            BlurSurfaceKey {
                input_width_with_overlap: 1900,
                ..key
            },
            BlurSurfaceKey {
                radius_px: 9,
                ..key
            },
            BlurSurfaceKey {
                blur_abi_version: BLUR_ABI_VERSION + 1,
                ..key
            },
        ] {
            assert!(!cache.is_valid(BlurFamily::Tonal, variant));
        }
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn selective_blurs_match_the_always_blur_gpu_path() {
        use image::{DynamicImage, ImageBuffer, Rgba};
        use tauri::Manager;

        let _test_guard = GPU_TEST_LOCK.lock().unwrap();
        let source = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(32, 24, |x, y| {
            Rgba([x as f32 / 31.0, y as f32 / 23.0, (x + y) as f32 / 54.0, 1.0])
        }));
        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock Tauri app builds");
        let state = app.state::<AppState>();
        let context = get_or_init_compute_gpu_context_for_tests(&state)
            .expect("compute-only GPU context initializes");

        let mut cases = Vec::new();
        cases.push(AllAdjustments::default());
        let mut exposure = AllAdjustments::default();
        exposure.global.exposure = 0.5;
        cases.push(exposure);
        let mut sharpness = AllAdjustments::default();
        sharpness.global.sharpness = 0.4;
        cases.push(sharpness);
        let mut tonal = AllAdjustments::default();
        tonal.global.shadows = 0.3;
        cases.push(tonal);
        let mut clarity = AllAdjustments::default();
        clarity.global.halation_amount = 0.2;
        cases.push(clarity);
        let mut structure = AllAdjustments::default();
        structure.global.dehaze = 0.3;
        cases.push(structure);
        let mut mask = AllAdjustments::default();
        mask.mask_count = 1;
        mask.mask_adjustments[0].clarity = 0.2;
        cases.push(mask);

        let mut selective_elapsed = Duration::ZERO;
        let mut full_elapsed = Duration::ZERO;
        FORCE_DISABLE_BLUR_CACHE.store(true, Ordering::Relaxed);
        for (index, adjustments) in cases.into_iter().enumerate() {
            let render = || {
                process_and_get_dynamic_image(
                    &context,
                    &state,
                    &source,
                    PreGpuImageIdentity::for_source(&source, "blur_pass_parity"),
                    RenderRequest {
                        adjustments,
                        mask_bitmaps: &[],
                        lut: None,
                        roi: None,
                    },
                    "blur_pass_parity",
                )
                .expect("GPU render succeeds")
            };
            FORCE_ALL_BLUR_PASSES.store(false, Ordering::Relaxed);
            let _ = render();
            FORCE_ALL_BLUR_PASSES.store(true, Ordering::Relaxed);
            let _ = render();
            FORCE_ALL_BLUR_PASSES.store(false, Ordering::Relaxed);
            let started = Instant::now();
            let selective = render();
            selective_elapsed += started.elapsed();
            FORCE_ALL_BLUR_PASSES.store(true, Ordering::Relaxed);
            let started = Instant::now();
            let always_blur = render();
            full_elapsed += started.elapsed();
            FORCE_ALL_BLUR_PASSES.store(false, Ordering::Relaxed);
            assert_eq!(
                selective.to_rgba16().into_raw(),
                always_blur.to_rgba16().into_raw(),
                "parity case {index} differs"
            );
        }
        eprintln!(
            "gpu graph benchmark: selective={selective_elapsed:?} forced_full={full_elapsed:?}"
        );
        FORCE_DISABLE_BLUR_CACHE.store(false, Ordering::Relaxed);
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn one_hundred_warm_edits_reuse_input_upload_and_blur_surface() {
        use image::{ImageBuffer, Rgba};
        use tauri::Manager;

        let _test_guard = GPU_TEST_LOCK.lock().unwrap();
        reset_gpu_input_cache_counters();
        let source = DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(
            16,
            16,
            Rgba([0.25, 0.5, 0.75, 1.0]),
        ));
        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock Tauri app builds");
        let state = app.state::<AppState>();
        let context = get_or_init_compute_gpu_context_for_tests(&state)
            .expect("compute-only GPU context initializes");
        let identity = PreGpuImageIdentity::for_source(&source, "exposure_reuse");
        for index in 0..100 {
            let mut adjustments = AllAdjustments::default();
            adjustments.global.exposure = index as f32 / 100.0;
            adjustments.global.clarity = 0.25;
            process_and_get_dynamic_image(
                &context,
                &state,
                &source,
                identity,
                RenderRequest {
                    adjustments,
                    mask_bitmaps: &[],
                    lut: None,
                    roi: None,
                },
                "exposure_reuse",
            )
            .expect("GPU render succeeds");
        }

        let counters = gpu_input_cache_counters();
        assert_eq!(counters.to_rgba_f16_calls, 1);
        assert_eq!(counters.texture_allocations, 1);
        assert_eq!(counters.view_allocations, 1);
        assert_eq!(counters.misses, 1);
        assert_eq!(counters.hits, 99);
        assert_eq!(counters.uploaded_bytes, 16 * 16 * 8);
        let processor = state.gpu_processor.lock().unwrap();
        let blur = processor
            .as_ref()
            .unwrap()
            .processor
            .blur_surface_cache
            .lock()
            .unwrap()
            .totals;
        assert_eq!(blur.cache_misses, 1);
        assert_eq!(blur.cache_hits, 99);
        assert_eq!(blur.dispatches, 2);
        assert_eq!(blur.submissions, 100);
    }
}

pub fn process_and_get_dynamic_image(
    context: &GpuContext,
    state: &tauri::State<AppState>,
    base_image: &DynamicImage,
    pre_gpu_identity: PreGpuImageIdentity,
    request: RenderRequest,
    caller_id: &str,
) -> Result<DynamicImage, String> {
    process_and_get_dynamic_image_inner(
        context,
        state,
        base_image,
        pre_gpu_identity,
        request,
        caller_id,
        false,
        None,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn process_and_get_unclamped_dynamic_image(
    context: &GpuContext,
    state: &tauri::State<AppState>,
    base_image: &DynamicImage,
    pre_gpu_identity: PreGpuImageIdentity,
    request: RenderRequest,
    caller_id: &str,
) -> Result<DynamicImage, String> {
    process_and_get_dynamic_image_inner(
        context,
        state,
        base_image,
        pre_gpu_identity,
        request,
        caller_id,
        false,
        None,
        true,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn process_and_get_dynamic_image_with_analytics(
    context: &GpuContext,
    state: &tauri::State<AppState>,
    base_image: &DynamicImage,
    pre_gpu_identity: PreGpuImageIdentity,
    request: RenderRequest,
    caller_id: &str,
    output_to_display: bool,
    analytics_config: Option<crate::AnalyticsConfig>,
) -> Result<DynamicImage, String> {
    process_and_get_dynamic_image_inner(
        context,
        state,
        base_image,
        pre_gpu_identity,
        request,
        caller_id,
        output_to_display,
        analytics_config,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
fn process_and_get_dynamic_image_inner(
    context: &GpuContext,
    state: &tauri::State<AppState>,
    base_image: &DynamicImage,
    pre_gpu_identity: PreGpuImageIdentity,
    request: RenderRequest,
    caller_id: &str,
    output_to_display: bool,
    analytics_config: Option<crate::AnalyticsConfig>,
    preserve_unclamped_float_readback: bool,
) -> Result<DynamicImage, String> {
    let start_time = Instant::now();
    let (width, height) = base_image.dimensions();
    let device = &context.device;
    let queue = &context.queue;
    if pre_gpu_identity.width != width || pre_gpu_identity.height != height {
        return Err(format!(
            "pre-GPU identity dimensions {}x{} do not match image {}x{}",
            pre_gpu_identity.width, pre_gpu_identity.height, width, height
        ));
    }
    let device_generation = Arc::as_ptr(&context.device) as usize as u64;

    let max_dim = context.limits.max_texture_dimension_2d;
    if width > max_dim || height > max_dim {
        log::warn!(
            "Image dimensions ({}x{}) exceed GPU limits ({}). Bypassing GPU processing and returning unprocessed image to prevent a crash. Try upgrading your GPU :)",
            width,
            height,
            max_dim
        );
        return Ok(apply_native_color_mixer_adjustments(
            std::borrow::Cow::Borrowed(base_image),
            &request.adjustments.global,
        )
        .into_owned());
    }

    let mut old_processor = None;
    let mut reallocated = false;

    let mut processor_lock = state.gpu_processor.lock().unwrap();
    if processor_lock.is_none()
        || processor_lock.as_ref().unwrap().width < width
        || processor_lock.as_ref().unwrap().height < height
    {
        let new_width = (width + 255) & !255;
        let new_height = (height + 255) & !255;
        log::info!(
            "Creating new GPU Processor for dimensions up to {}x{}",
            new_width,
            new_height
        );
        let new_processor = GpuProcessor::new(context.clone(), new_width, new_height)?;

        old_processor = processor_lock.take();

        *processor_lock = Some(crate::GpuProcessorState {
            processor: new_processor,
            width: new_width,
            height: new_height,
        });
        reallocated = true;
    }
    let processor_state = processor_lock.as_ref().unwrap();
    let processor = &processor_state.processor;

    if reallocated && let Some(old_state) = &old_processor {
        let mut encoder = device.create_command_encoder(&Default::default());
        let copy_w = old_state.width.min(processor_state.width);
        let copy_h = old_state.height.min(processor_state.height);

        encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &old_state.processor.output_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: &processor.output_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d {
                width: copy_w,
                height: copy_h,
                depth_or_array_layers: 1,
            },
        );
        queue.submit(Some(encoder.finish()));

        context.presentation.publish_texture(
            processor.output_texture_view.clone(),
            [width, height],
            [processor_state.width, processor_state.height],
        );
    }

    if let Some(cache) = state.gpu_image_cache.lock().unwrap().as_ref() {
        if cache.device_generation != device_generation {
            INPUT_DEVICE_MISSES.fetch_add(1, Ordering::Relaxed);
        } else if cache.width != width || cache.height != height {
            INPUT_DIMENSION_MISSES.fetch_add(1, Ordering::Relaxed);
        } else if cache.pre_gpu_identity != pre_gpu_identity {
            INPUT_IDENTITY_MISSES.fetch_add(1, Ordering::Relaxed);
        }
    }
    RenderCaches::new(state).clear_stale_gpu_image_cache(
        pre_gpu_identity,
        device_generation,
        width,
        height,
    );

    let mut cache_lock = state.gpu_image_cache.lock().unwrap();
    if cache_lock.is_none() {
        INPUT_CACHE_MISSES.fetch_add(1, Ordering::Relaxed);
        TO_RGBA_F16_CALLS.fetch_add(1, Ordering::Relaxed);
        let img_rgba_f16 = to_rgba_f16(base_image);
        let upload_bytes = img_rgba_f16.len() as u64 * size_of::<f16>() as u64;
        let rgba32f_temporary_bytes = u64::from(width) * u64::from(height) * 4 * 4;
        CONVERTED_BYTES.fetch_add(rgba32f_temporary_bytes + upload_bytes, Ordering::Relaxed);
        UPLOADED_BYTES.fetch_add(upload_bytes, Ordering::Relaxed);
        let texture_size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };
        let texture = device.create_texture_with_data(
            queue,
            &wgpu::TextureDescriptor {
                label: Some("Input Texture"),
                size: texture_size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba16Float,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            },
            TextureDataOrder::MipMajor,
            bytemuck::cast_slice(&img_rgba_f16),
        );
        INPUT_TEXTURE_ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        let texture_view = texture.create_view(&Default::default());
        INPUT_VIEW_ALLOCATIONS.fetch_add(1, Ordering::Relaxed);

        *cache_lock = Some(GpuImageCache {
            texture,
            texture_view,
            width,
            height,
            pre_gpu_identity,
            device_generation,
        });
    } else {
        INPUT_CACHE_HITS.fetch_add(1, Ordering::Relaxed);
    }
    log::debug!("GPU input cache counters: {:?}", gpu_input_cache_counters());

    let cache = cache_lock.as_ref().unwrap();

    let skip_readback = output_to_display;

    let (processed_pixels, out_w, out_h, out_x, out_y) = processor.run(
        InputTextureRef {
            view: &cache.texture_view,
            identity: cache.pre_gpu_identity,
            device_generation: cache.device_generation,
        },
        cache.width,
        cache.height,
        request,
        skip_readback,
        output_to_display,
    )?;

    let mut final_encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("Final Passes Encoder"),
    });
    let mut submit_final_encoder = false;

    let mut async_readback_buffer: Option<wgpu::Buffer> = None;
    let mut async_padded_bpr: u32 = 0;
    let mut async_unpadded_bpr: u32 = 0;

    if analytics_config.is_some() && skip_readback {
        let unpadded_bytes_per_row = GPU_OUTPUT_BYTES_PER_PIXEL * out_w;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
        let output_buffer_size = (padded_bytes_per_row * out_h) as u64;

        let output_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Async Analytics Readback Buffer"),
            size: output_buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        final_encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &processor.working_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: out_x,
                    y: out_y,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &output_buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(out_h),
                },
            },
            wgpu::Extent3d {
                width: out_w,
                height: out_h,
                depth_or_array_layers: 1,
            },
        );

        async_readback_buffer = Some(output_buffer);
        async_padded_bpr = padded_bytes_per_row;
        async_unpadded_bpr = unpadded_bytes_per_row;
        submit_final_encoder = true;
    }

    if output_to_display {
        final_encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &processor.working_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: out_x,
                    y: out_y,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: &processor.output_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: out_x,
                    y: out_y,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d {
                width: out_w,
                height: out_h,
                depth_or_array_layers: 1,
            },
        );
        submit_final_encoder = true;
    }

    if submit_final_encoder {
        queue.submit(Some(final_encoder.finish()));
    }

    if let Some(analytics) = analytics_config {
        if let Some(buffer) = async_readback_buffer {
            let output_buffer: wgpu::Buffer = buffer;
            let padded_bytes_per_row: u32 = async_padded_bpr;
            let unpadded_bytes_per_row: u32 = async_unpadded_bpr;
            let device_clone = context.device.clone();

            std::thread::spawn(move || {
                let buffer_slice = output_buffer.slice(..);
                let (tx, rx) = std::sync::mpsc::channel::<Result<(), wgpu::BufferAsyncError>>();

                buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
                    let _ = tx.send(result);
                });

                if let Err(e) = device_clone.poll(wgpu::PollType::Wait {
                    submission_index: None,
                    timeout: Some(std::time::Duration::from_secs(60)),
                }) {
                    log::error!("Async analytics readback poll failed: {}", e);
                    return;
                }

                if let Ok(Ok(())) = rx.recv() {
                    let padded_data = buffer_slice.get_mapped_range().to_vec();
                    output_buffer.unmap();

                    let mut unpadded_data =
                        Vec::with_capacity((unpadded_bytes_per_row * out_h) as usize);
                    if padded_bytes_per_row == unpadded_bytes_per_row {
                        unpadded_data = padded_data;
                    } else {
                        for chunk in padded_data.chunks(padded_bytes_per_row as usize) {
                            unpadded_data
                                .extend_from_slice(&chunk[..unpadded_bytes_per_row as usize]);
                        }
                    }

                    if let Ok(dynamic_img) =
                        rgba16float_readback_to_dynamic_image(out_w, out_h, unpadded_data)
                    {
                        let _ = analytics.scheduler.submit(crate::AnalyticsJob {
                            path: analytics.path,
                            frame_id: analytics.frame_id,
                            image: std::sync::Arc::new(dynamic_img),
                            products: analytics.products,
                            active_waveform_channel: analytics.active_waveform_channel,
                            policy: crate::AnalyticsSamplingPolicy::default(),
                        });
                    }
                }
            });
        } else {
            let pixels_clone = processed_pixels.clone();
            std::thread::spawn(move || {
                if let Ok(dynamic_img) =
                    rgba16float_readback_to_dynamic_image(out_w, out_h, pixels_clone)
                {
                    let _ = analytics.scheduler.submit(crate::AnalyticsJob {
                        path: analytics.path,
                        frame_id: analytics.frame_id,
                        image: std::sync::Arc::new(dynamic_img),
                        products: analytics.products,
                        active_waveform_channel: analytics.active_waveform_channel,
                        policy: crate::AnalyticsSamplingPolicy::default(),
                    });
                }
            });
        }
    }

    if output_to_display {
        context.presentation.publish_texture(
            processor.output_texture_view.clone(),
            [width, height],
            [processor_state.width, processor_state.height],
        );
    }

    drop(old_processor);

    if skip_readback {
        let duration = start_time.elapsed();
        let fps = 1.0 / duration.as_secs_f64();
        log::info!(
            "[{}] {}x{} native WGPU display updated in {:?} ({:.2} FPS)",
            caller_id,
            width,
            height,
            duration,
            fps
        );
        return Ok(DynamicImage::new_rgba8(0, 0));
    }

    let duration = start_time.elapsed();
    let fps = 1.0 / duration.as_secs_f64();
    log::info!(
        "[{}] {}x{} processed (ROI: {}x{}) on GPU in {:?} ({:.2} FPS)",
        caller_id,
        width,
        height,
        out_w,
        out_h,
        duration,
        fps
    );

    if preserve_unclamped_float_readback {
        rgba16float_readback_to_unclamped_dynamic_image(out_w, out_h, processed_pixels)
    } else {
        rgba16float_readback_to_dynamic_image(out_w, out_h, processed_pixels)
    }
}
