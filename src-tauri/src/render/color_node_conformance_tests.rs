use std::{borrow::Cow, collections::HashSet, sync::Arc};

use image::{DynamicImage, ImageBuffer, Luma, Rgba};
use rapidraw_color_reference::transfer::srgb_to_linear_channel;
use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

use super::color_node_registry::{COLOR_NODE_REGISTRY, ColorNodeBackend};
use super::render_plan::color_fingerprint_for_test;
use crate::AppState;
use crate::adjustments::abi::{AllAdjustments, GlobalAdjustments, MAX_MASKS, MaskAdjustments};
use crate::gpu_processing::{
    EditGraphExecutionAuthority, PreGpuImageIdentity, RenderRequest, Roi,
    get_or_init_compute_gpu_context_for_tests, process_and_get_unclamped_dynamic_image,
};
use crate::lut_processing::Lut;
use crate::mixer_render::apply_native_color_mixer_adjustments;
use crate::render_pipeline::apply_pre_gpu_detail_stages;

const REPORT_ENV: &str = "RAWENGINE_COLOR_NODE_PROOF_REPORT";
const RAW_TRACE_ENV: &str = "RAWENGINE_COLOR_GRAPH_TRACE_REPORT";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeReceipt {
    node_id: &'static str,
    version: u32,
    order: u16,
    input_domain: &'static str,
    output_domain: &'static str,
    backend: &'static str,
    tolerance: f64,
    identity_max_abs_delta: f64,
    non_default_max_abs_delta: f64,
    finite: bool,
    alpha_preserved: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RawTraceAssociation {
    report_path: String,
    graph_fingerprint: String,
    source_sha256: String,
    input_profile_identity: String,
    output_profile_identity: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeProofReport {
    contract: &'static str,
    registry_count: usize,
    receipts: Vec<NodeReceipt>,
    raw_trace: Option<RawTraceAssociation>,
}

fn source_fixture() -> DynamicImage {
    DynamicImage::ImageRgba32F(ImageBuffer::from_fn(32, 24, |x, y| {
        let checker = if (x / 4 + y / 4) % 2 == 0 {
            0.08
        } else {
            -0.05
        };
        Rgba([
            -0.05 + x as f32 / 24.0 + checker,
            0.04 + y as f32 / 18.0 - checker,
            0.08 + (x + y) as f32 / 38.0,
            0.73,
        ])
    }))
}

fn node_adjustments(id: &str) -> AllAdjustments {
    let mut value = AllAdjustments::default();
    match id {
        "exposure" => value.global.exposure = 0.6,
        "basic_tone" => {
            value.global.contrast = 0.25;
            value.global.highlights = -0.2;
            value.global.shadows = 0.18;
            value.global.whites = 0.12;
            value.global.blacks = -0.08;
            value.global.brightness = 0.08;
        }
        "white_balance" => {
            value.global.temperature = 0.18;
            value.global.tint = -0.12;
        }
        "hue_saturation_vibrance" => {
            value.global.hue = 18.0;
            value.global.saturation = 0.22;
            value.global.vibrance = 0.16;
        }
        "color_grading" => {
            value.global.color_grading_midtones.hue = 32.0;
            value.global.color_grading_midtones.saturation = 0.3;
            value.global.color_grading_midtones.luminance = 0.08;
            value.global.color_grading_blending = 0.5;
        }
        "color_calibration" => {
            value.global.color_calibration.red_hue = 0.18;
            value.global.color_calibration.red_saturation = 0.2;
            value.global.color_calibration.blue_hue = -0.12;
        }
        "levels" => {
            value.global.levels.enabled = 1;
            value.global.levels.input_black = 0.04;
            value.global.levels.input_white = 0.92;
            value.global.levels.gamma = 1.15;
            value.global.levels.output_black = 0.02;
            value.global.levels.output_white = 0.96;
        }
        "hsl_ranges" => {
            value.global.hsl[4].hue = 0.1;
            value.global.hsl[4].saturation = 0.25;
            value.global.hsl[4].luminance = -0.08;
        }
        "rgb_curves" => {
            value.global.luma_curve_count = 3;
            value.global.luma_curve[0].x = 0.0;
            value.global.luma_curve[0].y = 0.0;
            value.global.luma_curve[1].x = 127.5;
            value.global.luma_curve[1].y = 158.1;
            value.global.luma_curve[2].x = 255.0;
            value.global.luma_curve[2].y = 255.0;
        }
        "chroma_luma_noise_reduction" => {
            value.global.luma_noise_reduction = 0.42;
            value.global.color_noise_reduction = 0.36;
        }
        "sharpness" => {
            value.global.sharpness = 0.55;
            value.global.sharpness_threshold = 0.08;
        }
        "local_contrast" => {
            value.global.clarity = 0.3;
            value.global.centré = 0.12;
            value.global.structure = 0.2;
            value.global.dehaze = 0.18;
        }
        "vignette_grain_aberration" => {
            value.global.vignette_amount = -0.25;
            value.global.vignette_midpoint = 0.5;
            value.global.vignette_feather = 0.5;
            value.global.grain_amount = 0.16;
            value.global.grain_size = 0.25;
            value.global.grain_roughness = 0.5;
            value.global.chromatic_aberration_red_cyan = 0.08;
            value.global.chromatic_aberration_blue_yellow = -0.06;
        }
        "glow_halation_flare" => {
            value.global.glow_amount = 0.18;
            value.global.halation_amount = 0.14;
            value.global.flare_amount = 0.12;
        }
        "masked_adjustments" => {
            value.mask_count = 1;
            value.mask_atlas_cols = 1;
            value.mask_adjustments[0].exposure = 0.45;
            value.mask_adjustments[0].temperature = -0.12;
            value.mask_adjustments[0].clarity = 0.18;
        }
        "lut_3d" => {
            value.global.has_lut = 1;
            value.global.lut_intensity = 0.8;
        }
        "color_balance_rgb" => {
            value.global.color_balance_rgb.enabled = 1;
            value.global.color_balance_rgb.preserve_luminance = 0;
            value.global.color_balance_rgb.midtones = [30.0, -16.0, 12.0, 0.0];
        }
        "channel_mixer" => {
            value.global.channel_mixer.enabled = 1;
            value.global.channel_mixer.preserve_luminance = 0;
            value.global.channel_mixer.red.green = 1.0;
            value.global.channel_mixer.green.blue = 1.0;
            value.global.channel_mixer.blue.red = 1.0;
        }
        "black_white_mixer" => {
            value.global.black_white_mixer.enabled = 1;
            value.global.black_white_mixer.reds = 0.5;
            value.global.black_white_mixer.blues = -0.3;
        }
        "clipping_overlay" => value.global.show_clipping = 1,
        "tone_mapper" => value.global.tonemapper_mode = 1,
        "scene_denoise" | "scene_deblur" | "scene_wavelet_detail" => {}
        other => panic!("missing validation adapter for registered node {other}"),
    }
    value
}

fn detail_json(id: &str) -> Value {
    match id {
        "scene_denoise" => serde_json::json!({
            "denoiseEnabled": true, "lumaNoiseReduction": 45, "colorNoiseReduction": 30
        }),
        "scene_deblur" => serde_json::json!({
            "deblurEnabled": true, "deblurStrength": 55, "deblurSigmaPx": 0.8
        }),
        "scene_wavelet_detail" => serde_json::json!({
            "waveletDetailEnabled": true, "waveletDetailFine": 45, "waveletDetailMedium": 25,
            "waveletDetailEdgeThreshold": 0.2, "waveletDetailHaloSuppression": 0.7
        }),
        other => panic!("missing CPU detail adapter for {other}"),
    }
}

fn mask_fixture() -> ImageBuffer<Luma<u8>, Vec<u8>> {
    ImageBuffer::from_fn(32, 24, |x, _| Luma([((x * 255) / 31) as u8]))
}

fn lut_fixture() -> Arc<Lut> {
    Arc::new(Lut::compile(
        2,
        vec![
            0.0, 0.0, 0.0, 1.0, 0.08, 0.0, 0.0, 1.0, 0.0, 0.92, 0.0, 1.0, 1.0, 1.0, 0.0, 1.0, 0.0,
            0.0, 0.9, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0,
        ],
    ))
}

fn pixels(image: &DynamicImage) -> Vec<[f32; 4]> {
    image.to_rgba32f().pixels().map(|pixel| pixel.0).collect()
}

fn max_delta(left: &DynamicImage, right: &DynamicImage) -> f64 {
    pixels(left)
        .into_iter()
        .zip(pixels(right))
        .flat_map(|(left, right)| left.into_iter().take(3).zip(right))
        .map(|(left, right)| f64::from((left - right).abs()))
        .fold(0.0, f64::max)
}

fn finite_and_alpha_preserved(image: &DynamicImage, alpha: f32) -> (bool, bool) {
    let pixels = pixels(image);
    (
        pixels.iter().flatten().all(|value| value.is_finite()),
        pixels
            .iter()
            .all(|pixel| (pixel[3] - alpha).abs() <= 2.0e-3),
    )
}

fn monotone_neutral_row(values: &[[f32; 4]], width: usize, tolerance: f32) -> bool {
    (0..3).all(|channel| {
        values[..width]
            .windows(2)
            .all(|pair| pair[0][channel] <= pair[1][channel] + tolerance)
    })
}

fn backend_label(backend: ColorNodeBackend) -> &'static str {
    match backend {
        ColorNodeBackend::Cpu => "cpu",
        ColorNodeBackend::Wgpu => "wgpu",
        ColorNodeBackend::CpuPostWgpu => "cpu_post_wgpu",
    }
}

fn raw_trace_association() -> Option<RawTraceAssociation> {
    let path = std::env::var(RAW_TRACE_ENV).ok()?;
    let value: Value = serde_json::from_slice(&std::fs::read(&path).ok()?).ok()?;
    let trace = value.get("graphTrace")?;
    let identities = trace.get("identities")?;
    Some(RawTraceAssociation {
        report_path: path,
        graph_fingerprint: trace.get("previewGraphFingerprint")?.as_str()?.to_string(),
        source_sha256: identities.get("sourceSha256")?.as_str()?.to_string(),
        input_profile_identity: identities
            .get("inputTransformIdentity")?
            .as_str()?
            .to_string(),
        output_profile_identity: identities
            .get("outputProfileIdentity")?
            .as_str()?
            .to_string(),
    })
}

fn write_report(report: &NodeProofReport) {
    let Ok(path) = std::env::var(REPORT_ENV) else {
        return;
    };
    let path = std::path::PathBuf::from(path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create node proof parent");
    }
    std::fs::write(
        path,
        format!("{}\n", serde_json::to_string_pretty(report).unwrap()),
    )
    .expect("write node proof");
}

#[test]
fn registry_is_ordered_unique_and_every_node_has_an_executable_adapter() {
    let mut ids = HashSet::new();
    let mut previous = 0;
    for contract in COLOR_NODE_REGISTRY {
        assert!(ids.insert(contract.id), "duplicate node {}", contract.id);
        assert!(contract.order > previous, "node order must be strict");
        assert!(contract.version > 0);
        assert!(!contract.input_domain.is_empty() && !contract.output_domain.is_empty());
        assert!(contract.tolerance > 0.0);
        previous = contract.order;
        if contract.backend == ColorNodeBackend::Cpu {
            let _ = detail_json(contract.id);
        } else {
            let _ = node_adjustments(contract.id);
        }
    }
    assert_eq!(
        ids.len(),
        24,
        "new or removed production nodes require a contract and adapter"
    );
}

#[test]
fn production_cpu_and_wgpu_nodes_execute_identity_and_non_default_vectors() {
    let source = source_fixture();
    let app = tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock Tauri app builds");
    let state = app.state::<AppState>();
    let context = get_or_init_compute_gpu_context_for_tests(&state)
        .expect("compute-only GPU context initializes");
    let identity = process_and_get_unclamped_dynamic_image(
        &context,
        &state,
        &source,
        PreGpuImageIdentity::for_source(&source, "color_node_registry"),
        RenderRequest {
            adjustments: AllAdjustments::default(),
            mask_bitmaps: &[],
            lut: None,
            roi: None,
            edit_graph: EditGraphExecutionAuthority::TestOnlyLegacy,
        },
        "color_node_registry_identity",
    )
    .expect("identity production WGPU render");
    let identity_repeat = process_and_get_unclamped_dynamic_image(
        &context,
        &state,
        &source,
        PreGpuImageIdentity::for_source(&source, "color_node_registry"),
        RenderRequest {
            adjustments: AllAdjustments::default(),
            mask_bitmaps: &[],
            lut: None,
            roi: None,
            edit_graph: EditGraphExecutionAuthority::TestOnlyLegacy,
        },
        "color_node_registry_identity_repeat",
    )
    .expect("repeated identity production WGPU render");
    let identity_delta = max_delta(&identity, &identity_repeat);
    assert!(
        identity_delta <= 1.0e-7,
        "identity path must be deterministic"
    );

    let mask = mask_fixture();
    let mut receipts = Vec::new();
    for contract in COLOR_NODE_REGISTRY {
        let output = match contract.backend {
            ColorNodeBackend::Cpu => {
                let neutral =
                    apply_pre_gpu_detail_stages(&source, 1, &serde_json::json!({}), false);
                assert!(matches!(neutral.image, Cow::Borrowed(_)));
                apply_pre_gpu_detail_stages(&source, 1, &detail_json(contract.id), false)
                    .image
                    .into_owned()
            }
            ColorNodeBackend::CpuPostWgpu => apply_native_color_mixer_adjustments(
                Cow::Borrowed(&identity),
                &node_adjustments(contract.id).global,
            )
            .into_owned(),
            ColorNodeBackend::Wgpu => {
                let adjustments = node_adjustments(contract.id);
                let masks = if contract.id == "masked_adjustments" {
                    std::slice::from_ref(&mask)
                } else {
                    &[]
                };
                let lut = (contract.id == "lut_3d").then(lut_fixture);
                process_and_get_unclamped_dynamic_image(
                    &context,
                    &state,
                    &source,
                    PreGpuImageIdentity::for_source(&source, "color_node_registry"),
                    RenderRequest {
                        adjustments,
                        mask_bitmaps: masks,
                        lut,
                        roi: None,
                        edit_graph: EditGraphExecutionAuthority::TestOnlyLegacy,
                    },
                    contract.id,
                )
                .unwrap_or_else(|error| panic!("{} production render failed: {error}", contract.id))
            }
        };
        let (finite, alpha_preserved) = if contract.backend == ColorNodeBackend::Cpu {
            let (finite, source_alpha) = finite_and_alpha_preserved(&output, 0.73);
            let (_, canonical_opaque) = finite_and_alpha_preserved(&output, 1.0);
            (finite, source_alpha || canonical_opaque)
        } else {
            finite_and_alpha_preserved(&output, 0.73)
        };
        let effect_delta = max_delta(
            &output,
            if contract.backend == ColorNodeBackend::Cpu {
                &source
            } else {
                &identity
            },
        );
        assert!(finite, "{} emitted non-finite pixels", contract.id);
        assert!(alpha_preserved, "{} changed alpha", contract.id);
        assert!(
            effect_delta > 1.0e-5,
            "{} non-default adapter had no pixel effect",
            contract.id
        );
        receipts.push(NodeReceipt {
            node_id: contract.id,
            version: contract.version,
            order: contract.order,
            input_domain: contract.input_domain,
            output_domain: contract.output_domain,
            backend: backend_label(contract.backend),
            tolerance: contract.tolerance,
            identity_max_abs_delta: identity_delta,
            non_default_max_abs_delta: effect_delta,
            finite,
            alpha_preserved,
        });
    }
    assert_eq!(receipts.len(), COLOR_NODE_REGISTRY.len());
    let report = NodeProofReport {
        contract: "rapidraw.executable-color-node-conformance.v1",
        registry_count: COLOR_NODE_REGISTRY.len(),
        receipts,
        raw_trace: raw_trace_association(),
    };
    write_report(&report);
}

#[test]
fn production_wgpu_nodes_satisfy_metamorphic_color_properties() {
    let source = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(32, 8, |x, _| {
        let value = 0.02 + x as f32 / 31.0 * 0.45;
        Rgba([value, value, value, 1.0])
    }));
    let app = tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock Tauri app builds");
    let state = app.state::<AppState>();
    let context = get_or_init_compute_gpu_context_for_tests(&state)
        .expect("compute-only GPU context initializes");
    let render = |adjustments, masks: &[ImageBuffer<Luma<u8>, Vec<u8>>], roi, label| {
        process_and_get_unclamped_dynamic_image(
            &context,
            &state,
            &source,
            PreGpuImageIdentity::for_source(&source, "color_metamorphic"),
            RenderRequest {
                adjustments,
                mask_bitmaps: masks,
                lut: None,
                roi,
                edit_graph: EditGraphExecutionAuthority::TestOnlyLegacy,
            },
            label,
        )
        .unwrap_or_else(|error| panic!("{label} render failed: {error}"))
    };

    let identity = render(AllAdjustments::default(), &[], None, "metamorphic_identity");
    let exposure_ev = 0.75;
    let mut plus = AllAdjustments::default();
    plus.global.exposure = exposure_ev;
    let mut minus = AllAdjustments::default();
    minus.global.exposure = -exposure_ev;
    let plus = pixels(&render(plus, &[], None, "metamorphic_exposure_plus"));
    let minus = pixels(&render(minus, &[], None, "metamorphic_exposure_minus"));
    let identity_pixels = pixels(&identity);
    let exposure_scale = 2.0_f32.powf(exposure_ev);
    let mut plus_roundtrip_error = 0.0_f32;
    let mut minus_roundtrip_error = 0.0_f32;
    for ((plus, minus), identity) in plus.iter().zip(&minus).zip(&identity_pixels) {
        for channel in 0..3 {
            let plus_linear = srgb_to_linear_channel(f64::from(plus[channel])) as f32;
            let minus_linear = srgb_to_linear_channel(f64::from(minus[channel])) as f32;
            let identity_linear = srgb_to_linear_channel(f64::from(identity[channel])) as f32;
            plus_roundtrip_error =
                plus_roundtrip_error.max((plus_linear / exposure_scale - identity_linear).abs());
            minus_roundtrip_error =
                minus_roundtrip_error.max((minus_linear * exposure_scale - identity_linear).abs());
        }
    }
    assert!(
        plus_roundtrip_error <= 2.0e-3,
        "positive exposure inverse error {plus_roundtrip_error}"
    );
    assert!(
        minus_roundtrip_error <= 2.0e-3,
        "negative exposure inverse error {minus_roundtrip_error}"
    );

    for (id, adjustments) in [
        ("rgb_curves", node_adjustments("rgb_curves")),
        ("tone_mapper", node_adjustments("tone_mapper")),
    ] {
        let output = pixels(&render(adjustments, &[], None, id));
        assert!(
            monotone_neutral_row(&output, 32, 2.0e-4),
            "{id} must preserve a monotone neutral ramp"
        );
        assert!(output.iter().all(|pixel| {
            (pixel[0] - pixel[1]).abs() <= 2.0e-3 && (pixel[1] - pixel[2]).abs() <= 2.0e-3
        }));
        let mut injected_reversal = output;
        injected_reversal.swap(0, 31);
        assert!(
            !monotone_neutral_row(&injected_reversal, 32, 2.0e-4),
            "{id} monotonicity gate must detect an injected ordering defect"
        );
    }

    let zero_mask = ImageBuffer::from_pixel(32, 8, Luma([0]));
    let one_mask = ImageBuffer::from_pixel(32, 8, Luma([255]));
    let mut masked = AllAdjustments {
        mask_count: 1,
        mask_atlas_cols: 1,
        ..AllAdjustments::default()
    };
    masked.mask_adjustments[0].exposure = 0.5;
    let zero = render(masked, std::slice::from_ref(&zero_mask), None, "mask_zero");
    assert!(max_delta(&zero, &identity) <= 8.0e-4);
    let one = render(masked, std::slice::from_ref(&one_mask), None, "mask_one");
    let mut global = AllAdjustments::default();
    global.global.exposure = 0.5;
    let global = render(global, &[], None, "mask_global_equivalent");
    assert!(max_delta(&one, &global) <= 2.0e-3);

    let mut tiled_adjustments = AllAdjustments::default();
    tiled_adjustments.global.exposure = 0.4;
    tiled_adjustments.global.grain_amount = 0.12;
    tiled_adjustments.global.grain_size = 0.8;
    tiled_adjustments.global.grain_roughness = 0.4;
    let full = render(tiled_adjustments, &[], None, "tile_full").to_rgba32f();
    let left = render(
        tiled_adjustments,
        &[],
        Some(Roi {
            x: 0,
            y: 0,
            width: 16,
            height: 8,
        }),
        "tile_left",
    )
    .to_rgba32f();
    let right = render(
        tiled_adjustments,
        &[],
        Some(Roi {
            x: 16,
            y: 0,
            width: 16,
            height: 8,
        }),
        "tile_right",
    )
    .to_rgba32f();
    for y in 0..8 {
        for x in 0..32 {
            let tiled = if x < 16 {
                left.get_pixel(x, y)
            } else {
                right.get_pixel(x - 16, y)
            };
            let expected = full.get_pixel(x, y);
            assert!(
                tiled
                    .0
                    .iter()
                    .zip(expected.0)
                    .all(|(actual, expected)| (actual - expected).abs() <= 8.0e-4)
            );
        }
    }
}

#[test]
fn every_registered_pixel_adapter_mutates_the_color_cache_fingerprint() {
    let identity = AllAdjustments::default();
    let identity_fingerprint = color_fingerprint_for_test(&identity, None);
    for contract in COLOR_NODE_REGISTRY {
        if contract.backend == ColorNodeBackend::Cpu {
            continue;
        }
        let adjustments = node_adjustments(contract.id);
        let lut = (contract.id == "lut_3d").then(lut_fixture);
        assert_ne!(
            color_fingerprint_for_test(&adjustments, lut.as_deref()),
            identity_fingerprint,
            "{} must invalidate the color cache fingerprint",
            contract.id
        );
    }
}

#[test]
fn point_color_global_and_mask_abi_bindings_preserve_runtime_fields() {
    let mut global = GlobalAdjustments::default();
    global.point_color.control = [3, 2, 1, 0];
    global.point_color.points[0].control = [0.25, 0.75, 2.0, 1.0];
    global_abi_coverage_tripwire(global);
    assert_eq!(global.point_color.control, [3, 2, 1, 0]);
    assert_eq!(global.point_color.points[0].control, [0.25, 0.75, 2.0, 1.0]);

    let mut mask = MaskAdjustments::default();
    mask.point_color.control = [1, 0, 1, 0];
    mask.point_color.skin_target = [0.62, 0.14, 28.0, 1.0];
    mask_abi_coverage_tripwire(mask);
    assert_eq!(mask.point_color.control, [1, 0, 1, 0]);
    assert_eq!(mask.point_color.skin_target, [0.62, 0.14, 28.0, 1.0]);
}

// Exhaustive destructuring is a compile-time tripwire: adding an ABI field requires
// explicitly assigning it to a registered node instead of silently escaping coverage.
#[allow(dead_code, clippy::too_many_lines)]
fn global_abi_coverage_tripwire(global: GlobalAdjustments) {
    let GlobalAdjustments {
        exposure,
        brightness,
        contrast,
        highlights,
        shadows,
        whites,
        blacks,
        saturation,
        temperature,
        tint,
        vibrance,
        hue,
        edit_graph_version,
        dehaze_atmosphere_r,
        dehaze_atmosphere_g,
        dehaze_atmosphere_b,
        technical_white_balance,
        sharpness,
        luma_noise_reduction,
        color_noise_reduction,
        clarity,
        dehaze,
        structure,
        centré,
        vignette_amount,
        vignette_midpoint,
        vignette_roundness,
        vignette_feather,
        grain_amount,
        grain_size,
        grain_roughness,
        chromatic_aberration_red_cyan,
        chromatic_aberration_blue_yellow,
        show_clipping,
        is_raw_image,
        dehaze_atmosphere_confidence,
        has_lut,
        lut_intensity,
        tonemapper_mode,
        _pad_lut2,
        _pad_lut3,
        _pad_lut4,
        _pad_lut5,
        _pad_agx1,
        _pad_agx2,
        _pad_agx3,
        _pad_wgsl_agx_align1,
        _pad_wgsl_agx_align2,
        _pad_wgsl_agx_align3,
        agx_pipe_to_rendering_matrix,
        agx_rendering_to_pipe_matrix,
        rapid_view_parameters0,
        rapid_view_parameters1,
        rapid_view_parameters2,
        tone_equalizer,
        point_color,
        scene_curve_knots,
        scene_curve_parameters,
        output_curve_knots,
        output_curve_parameters,
        _pad_cg1,
        _pad_cg2,
        _pad_cg3,
        _pad_cg4,
        color_grading_shadows,
        color_grading_midtones,
        color_grading_highlights,
        color_grading_global,
        color_grading_blending,
        color_grading_balance,
        _pad2,
        _pad3,
        color_calibration,
        color_balance_rgb,
        channel_mixer,
        black_white_mixer,
        levels,
        hsl,
        luma_curve,
        red_curve,
        green_curve,
        blue_curve,
        luma_curve_count,
        red_curve_count,
        green_curve_count,
        blue_curve_count,
        _pad_end1,
        _pad_end2,
        _pad_end3,
        _pad_end4,
        glow_amount,
        halation_amount,
        flare_amount,
        sharpness_threshold,
        point_color,
    } = global;
    let _ = (
        exposure,
        brightness,
        contrast,
        highlights,
        shadows,
        whites,
        blacks,
        saturation,
        temperature,
        tint,
        vibrance,
        hue,
        edit_graph_version,
        dehaze_atmosphere_r,
        dehaze_atmosphere_g,
        dehaze_atmosphere_b,
        technical_white_balance,
        sharpness,
        luma_noise_reduction,
        color_noise_reduction,
        clarity,
        dehaze,
        structure,
        centré,
        vignette_amount,
        vignette_midpoint,
        vignette_roundness,
        vignette_feather,
        grain_amount,
        grain_size,
        grain_roughness,
        chromatic_aberration_red_cyan,
        chromatic_aberration_blue_yellow,
        show_clipping,
        is_raw_image,
        dehaze_atmosphere_confidence,
        has_lut,
        lut_intensity,
        tonemapper_mode,
        _pad_lut2,
        _pad_lut3,
        _pad_lut4,
        _pad_lut5,
        _pad_agx1,
        _pad_agx2,
        _pad_agx3,
        _pad_wgsl_agx_align1,
        _pad_wgsl_agx_align2,
        _pad_wgsl_agx_align3,
        agx_pipe_to_rendering_matrix,
        agx_rendering_to_pipe_matrix,
        rapid_view_parameters0,
        rapid_view_parameters1,
        rapid_view_parameters2,
        tone_equalizer,
        point_color,
        scene_curve_knots,
        scene_curve_parameters,
        output_curve_knots,
        output_curve_parameters,
        _pad_cg1,
        _pad_cg2,
        _pad_cg3,
        _pad_cg4,
        color_grading_shadows,
        color_grading_midtones,
        color_grading_highlights,
        color_grading_global,
        color_grading_blending,
        color_grading_balance,
        _pad2,
        _pad3,
        color_calibration,
        color_balance_rgb,
        channel_mixer,
        black_white_mixer,
        levels,
        hsl,
        luma_curve,
        red_curve,
        green_curve,
        blue_curve,
        luma_curve_count,
        red_curve_count,
        green_curve_count,
        blue_curve_count,
        _pad_end1,
        _pad_end2,
        _pad_end3,
        _pad_end4,
        glow_amount,
        halation_amount,
        flare_amount,
        sharpness_threshold,
        point_color,
    );
}

#[allow(dead_code, clippy::too_many_lines)]
fn mask_abi_coverage_tripwire(mask: MaskAdjustments) {
    let MaskAdjustments {
        exposure,
        brightness,
        contrast,
        highlights,
        shadows,
        whites,
        blacks,
        saturation,
        temperature,
        tint,
        vibrance,
        sharpness,
        luma_noise_reduction,
        color_noise_reduction,
        clarity,
        dehaze,
        structure,
        glow_amount,
        halation_amount,
        flare_amount,
        sharpness_threshold,
        hue,
        blend_mode,
        tone_equalizer,
        point_color,
        _pad_cg2,
        color_grading_shadows,
        color_grading_midtones,
        color_grading_highlights,
        color_grading_global,
        color_grading_blending,
        color_grading_balance,
        _pad5,
        _pad6,
        hsl,
        luma_curve,
        red_curve,
        green_curve,
        blue_curve,
        luma_curve_count,
        red_curve_count,
        green_curve_count,
        blue_curve_count,
        _pad_end4,
        _pad_end5,
        _pad_end6,
        _pad_end7,
        point_color,
    } = mask;
    let _ = (
        exposure,
        brightness,
        contrast,
        highlights,
        shadows,
        whites,
        blacks,
        saturation,
        temperature,
        tint,
        vibrance,
        sharpness,
        luma_noise_reduction,
        color_noise_reduction,
        clarity,
        dehaze,
        structure,
        glow_amount,
        halation_amount,
        flare_amount,
        sharpness_threshold,
        hue,
        blend_mode,
        tone_equalizer,
        point_color,
        _pad_cg2,
        color_grading_shadows,
        color_grading_midtones,
        color_grading_highlights,
        color_grading_global,
        color_grading_blending,
        color_grading_balance,
        _pad5,
        _pad6,
        hsl,
        luma_curve,
        red_curve,
        green_curve,
        blue_curve,
        luma_curve_count,
        red_curve_count,
        green_curve_count,
        blue_curve_count,
        _pad_end4,
        _pad_end5,
        _pad_end6,
        _pad_end7,
        point_color,
    );
}

#[allow(dead_code)]
fn all_adjustments_abi_coverage_tripwire(all: AllAdjustments) {
    let AllAdjustments {
        global,
        mask_adjustments,
        mask_count,
        tile_offset_x,
        tile_offset_y,
        mask_atlas_cols,
        blur_pass_flags,
        execution_phase,
        source_width,
        source_height,
    } = all;
    global_abi_coverage_tripwire(global);
    mask_abi_coverage_tripwire(mask_adjustments[0]);
    let _: [MaskAdjustments; MAX_MASKS] = mask_adjustments;
    let _ = (
        mask_count,
        tile_offset_x,
        tile_offset_y,
        mask_atlas_cols,
        blur_pass_flags,
        execution_phase,
        source_width,
        source_height,
    );
}
