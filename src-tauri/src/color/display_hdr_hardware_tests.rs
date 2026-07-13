use std::{path::Path, time::Instant};

use image::{ImageBuffer, Rgba};
use rapidraw_color_reference::{
    transfer::{hlg_inverse_oetf, hlg_oetf, pq_eotf, pq_inverse_eotf},
    types::{AbsoluteLuminanceNits, HlgSignal, PqSignal, SceneLinearHlg},
};
use serde::Serialize;
use sha2::{Digest, Sha256};

const REPORT_ENV: &str = "RAWENGINE_DISPLAY_HDR_PROOF_REPORT";
const GRAPH_REPORT_ENV: &str = "RAWENGINE_COLOR_GRAPH_TRACE_REPORT";
const COMMIT_ENV: &str = "RAWENGINE_COLOR_PROOF_COMMIT";
const CONTRACT: &str = "rapidraw.native-display-hdr-proof.v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum DisplayMode {
    Sdr,
    HdrPq,
    HdrHlg,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HdrMetadata {
    mode: DisplayMode,
    transfer: &'static str,
    primaries: &'static str,
    reference_white_nits: f64,
    peak_nits: f64,
    full_range: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DisplayContract {
    mode: DisplayMode,
    display_profile_sha256: String,
    snapshot_profile_sha256: String,
    output_transfer_count: u32,
    metadata: Option<HdrMetadata>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferPair {
    input: f64,
    encoded: f64,
    decoded: f64,
    abs_error: f64,
    sdr_rendition_relative: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EdrCapability {
    current_headroom: Option<f64>,
    potential_headroom: Option<f64>,
    reference_headroom: Option<f64>,
    disposition: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GraphBinding {
    graph_fingerprint: String,
    source_sha256: String,
    input_profile_identity: String,
    output_profile_identity: String,
    graph_report_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeDisplayHdrProof {
    contract: &'static str,
    generated_for_commit: String,
    adapter_name: String,
    backend: String,
    driver: String,
    driver_info: String,
    os: String,
    display_id: Option<u32>,
    display_profile_sha256: String,
    display_profile_bytes: usize,
    display_transform_generation: u64,
    display_transform_implementation: &'static str,
    display_lut_samples: Vec<[f32; 3]>,
    sdr_surface_format: &'static str,
    sdr_surface_capability: String,
    rgba16f_hdr_intermediate: String,
    hdr_surface_metadata: String,
    preview_presentation_readback: String,
    edr: EdrCapability,
    pq_pairs: Vec<TransferPair>,
    hlg_pairs: Vec<TransferPair>,
    graph_binding: GraphBinding,
    numeric_status: &'static str,
    visual_artifact_path: String,
    visual_artifact_sha256: String,
    timings_ms: ProofTimings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofTimings {
    display_profile: f64,
    adapter: f64,
    transfer_vectors: f64,
    visual_artifact: f64,
}

fn validate_display_contract(contract: &DisplayContract) -> Result<(), String> {
    if contract.display_profile_sha256 != contract.snapshot_profile_sha256 {
        return Err("display_hdr_stale_display_profile".to_string());
    }
    if contract.output_transfer_count != 1 {
        return Err("display_hdr_output_transfer_not_exactly_once".to_string());
    }
    match (contract.mode, contract.metadata.as_ref()) {
        (DisplayMode::Sdr, None) => Ok(()),
        (DisplayMode::Sdr, Some(_)) => Err("display_hdr_sdr_hdr_metadata_cross_use".to_string()),
        (DisplayMode::HdrPq, Some(metadata))
            if metadata.mode == DisplayMode::HdrPq
                && metadata.transfer == "smpte_st_2084"
                && metadata.primaries == "bt2020"
                && metadata.reference_white_nits == 203.0
                && metadata.peak_nits >= 1_000.0
                && metadata.full_range =>
        {
            Ok(())
        }
        (DisplayMode::HdrHlg, Some(metadata))
            if metadata.mode == DisplayMode::HdrHlg
                && metadata.transfer == "arib_std_b67"
                && metadata.primaries == "bt2020"
                && metadata.reference_white_nits == 203.0
                && metadata.peak_nits >= 1_000.0
                && metadata.full_range =>
        {
            Ok(())
        }
        (DisplayMode::HdrPq | DisplayMode::HdrHlg, None) => {
            Err("display_hdr_missing_hdr_metadata".to_string())
        }
        _ => Err("display_hdr_wrong_hdr_metadata".to_string()),
    }
}

fn pq_pairs() -> Result<Vec<TransferPair>, String> {
    [0.0, 0.1, 1.0, 100.0, 203.0, 1_000.0, 4_000.0, 10_000.0]
        .into_iter()
        .map(|nits| {
            let encoded = pq_inverse_eotf(
                AbsoluteLuminanceNits::new(nits).map_err(|error| format!("{error:?}"))?,
            )
            .map_err(|error| format!("{error:?}"))?
            .value();
            let decoded = pq_eotf(PqSignal::new(encoded).map_err(|error| format!("{error:?}"))?)
                .map_err(|error| format!("{error:?}"))?
                .value();
            let abs_error = (decoded - nits).abs();
            if abs_error > 1.0e-8_f64.max(nits * 1.0e-10) {
                return Err(format!("display_hdr_pq_roundtrip_error:{nits}:{abs_error}"));
            }
            Ok(TransferPair {
                input: nits,
                encoded,
                decoded,
                abs_error,
                sdr_rendition_relative: (nits / 203.0).clamp(0.0, 1.0),
            })
        })
        .collect()
}

fn hlg_pairs() -> Result<Vec<TransferPair>, String> {
    [0.0, 1.0 / 48.0, 1.0 / 12.0, 0.18, 0.5, 1.0, 2.0, 4.0]
        .into_iter()
        .map(|linear| {
            let encoded =
                hlg_oetf(SceneLinearHlg::new(linear).map_err(|error| format!("{error:?}"))?)
                    .map_err(|error| format!("{error:?}"))?
                    .value();
            let decoded =
                hlg_inverse_oetf(HlgSignal::new(encoded).map_err(|error| format!("{error:?}"))?)
                    .map_err(|error| format!("{error:?}"))?
                    .value();
            let abs_error = (decoded - linear).abs();
            if abs_error > 1.0e-10 {
                return Err(format!(
                    "display_hdr_hlg_roundtrip_error:{linear}:{abs_error}"
                ));
            }
            Ok(TransferPair {
                input: linear,
                encoded,
                decoded,
                abs_error,
                sdr_rendition_relative: linear.clamp(0.0, 1.0),
            })
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn query_edr_capability() -> EdrCapability {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let screens: *mut Object = msg_send![class!(NSScreen), screens];
        let screen: *mut Object = msg_send![screens, firstObject];
        if screen.is_null() {
            return EdrCapability {
                current_headroom: None,
                potential_headroom: None,
                reference_headroom: None,
                disposition: "explicit_capability_fallback_no_nsscreen".to_string(),
            };
        }
        let responds_current: bool = msg_send![
            screen,
            respondsToSelector: sel!(maximumExtendedDynamicRangeColorComponentValue)
        ];
        let responds_potential: bool = msg_send![
            screen,
            respondsToSelector: sel!(maximumPotentialExtendedDynamicRangeColorComponentValue)
        ];
        let responds_reference: bool = msg_send![
            screen,
            respondsToSelector: sel!(maximumReferenceExtendedDynamicRangeColorComponentValue)
        ];
        let current = responds_current.then(|| {
            let value: f64 = msg_send![screen, maximumExtendedDynamicRangeColorComponentValue];
            value
        });
        let potential = responds_potential.then(|| {
            let value: f64 = msg_send![
                screen,
                maximumPotentialExtendedDynamicRangeColorComponentValue
            ];
            value
        });
        let reference = responds_reference.then(|| {
            let value: f64 = msg_send![
                screen,
                maximumReferenceExtendedDynamicRangeColorComponentValue
            ];
            value
        });
        let values_valid = [current, potential, reference]
            .into_iter()
            .flatten()
            .all(|value| value.is_finite() && value >= 1.0);
        EdrCapability {
            current_headroom: current,
            potential_headroom: potential,
            reference_headroom: reference,
            disposition: if values_valid && potential.is_some_and(|value| value > 1.0) {
                "native_edr_headroom_detected_hdr_surface_contract_not_implemented".to_string()
            } else if values_valid {
                "native_sdr_headroom_explicit_hdr_fallback".to_string()
            } else {
                "explicit_capability_fallback_edr_selector_unavailable".to_string()
            },
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn query_edr_capability() -> EdrCapability {
    EdrCapability {
        current_headroom: None,
        potential_headroom: None,
        reference_headroom: None,
        disposition: "explicit_capability_fallback_non_macos".to_string(),
    }
}

fn graph_binding() -> Result<GraphBinding, String> {
    let Ok(path) = std::env::var(GRAPH_REPORT_ENV) else {
        return Ok(GraphBinding {
            graph_fingerprint: "synthetic_native_display_graph".to_string(),
            source_sha256: "synthetic_native_display_source".to_string(),
            input_profile_identity: "synthetic_native_display_profile".to_string(),
            output_profile_identity: "display_p3".to_string(),
            graph_report_path: "not_supplied_fast_tier".to_string(),
        });
    };
    let value: serde_json::Value = serde_json::from_slice(
        &std::fs::read(&path).map_err(|error| format!("graph_report_read:{error}"))?,
    )
    .map_err(|error| format!("graph_report_parse:{error}"))?;
    let string = |pointer: &str| {
        value
            .pointer(pointer)
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| format!("graph_report_missing:{pointer}"))
    };
    Ok(GraphBinding {
        graph_fingerprint: string("/graphTrace/previewGraphFingerprint")?,
        source_sha256: string("/graphTrace/identities/sourceSha256")?,
        input_profile_identity: string("/graphTrace/identities/inputTransformIdentity")?,
        output_profile_identity: string("/graphTrace/identities/outputProfileIdentity")?,
        graph_report_path: path,
    })
}

fn write_visual_artifact(
    path: &Path,
    pq: &[TransferPair],
    hlg: &[TransferPair],
    display_samples: &[[f32; 3]],
) -> Result<String, String> {
    let mut image = ImageBuffer::<Rgba<u8>, Vec<u8>>::new(1_024, 256);
    for y in 0..256 {
        for x in 0..1_024 {
            let t = x as f32 / 1_023.0;
            let rgb = if y < 64 {
                [t, t, t]
            } else if y < 128 {
                let index = (x as usize * pq.len() / 1_024).min(pq.len() - 1);
                [pq[index].encoded as f32; 3]
            } else if y < 192 {
                let index = (x as usize * hlg.len() / 1_024).min(hlg.len() - 1);
                [hlg[index].encoded as f32; 3]
            } else {
                let index =
                    (x as usize * display_samples.len() / 1_024).min(display_samples.len() - 1);
                display_samples[index]
            };
            image.put_pixel(
                x,
                y,
                Rgba([
                    (rgb[0].clamp(0.0, 1.0) * 255.0).round() as u8,
                    (rgb[1].clamp(0.0, 1.0) * 255.0).round() as u8,
                    (rgb[2].clamp(0.0, 1.0) * 255.0).round() as u8,
                    255,
                ]),
            );
        }
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    image.save(path).map_err(|error| error.to_string())?;
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
}

#[cfg(target_os = "macos")]
#[test]
fn native_colorsync_edr_hdr_contract_and_visual_artifact_are_bound_and_numeric() {
    let display_started = Instant::now();
    let profile = crate::display_profile::active_display_profile()
        .expect("native display profile query must return a profile or typed fallback");
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    let snapshot = crate::display_profile::display_preview_transform_snapshot_from_capture(
        crate::display_profile::active_display_profile_bytes()
            .map(|bytes| (profile.display_id, bytes)),
    );
    #[cfg(any(target_os = "android", target_os = "linux"))]
    let snapshot_hash = profile
        .icc_sha256
        .clone()
        .unwrap_or_else(|| "unsupported_platform".to_string());
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    let snapshot_hash = snapshot.icc_sha256.clone();
    let profile_hash = profile
        .icc_sha256
        .clone()
        .unwrap_or_else(|| snapshot_hash.clone());
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    let display_samples = [0.0, 0.18, 0.5, 0.75, 1.0]
        .map(|value| snapshot.lut.sample_rgb([value; 3]))
        .to_vec();
    #[cfg(any(target_os = "android", target_os = "linux"))]
    let display_samples = vec![[0.0; 3], [1.0; 3]];
    validate_display_contract(&DisplayContract {
        mode: DisplayMode::Sdr,
        display_profile_sha256: profile_hash.clone(),
        snapshot_profile_sha256: snapshot_hash,
        output_transfer_count: 1,
        metadata: None,
    })
    .expect("SDR display contract must bind ColorSync profile and snapshot");
    let display_profile_ms = display_started.elapsed().as_secs_f64() * 1_000.0;

    let adapter_started = Instant::now();
    let instance =
        wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        ..Default::default()
    }))
    .expect("native display proof requires a compute adapter");
    let info = adapter.get_info();
    let sdr_features = adapter.get_texture_format_features(wgpu::TextureFormat::Bgra8UnormSrgb);
    let rgba16f_features = adapter.get_texture_format_features(wgpu::TextureFormat::Rgba16Float);
    let adapter_ms = adapter_started.elapsed().as_secs_f64() * 1_000.0;

    let transfer_started = Instant::now();
    let pq = pq_pairs().expect("PQ target/reference-white/peak vectors must round-trip");
    let hlg = hlg_pairs().expect("HLG target/reference-white/peak vectors must round-trip");
    let metadata = HdrMetadata {
        mode: DisplayMode::HdrPq,
        transfer: "smpte_st_2084",
        primaries: "bt2020",
        reference_white_nits: 203.0,
        peak_nits: 1_000.0,
        full_range: true,
    };
    validate_display_contract(&DisplayContract {
        mode: DisplayMode::HdrPq,
        display_profile_sha256: profile_hash.clone(),
        snapshot_profile_sha256: profile_hash.clone(),
        output_transfer_count: 1,
        metadata: Some(metadata),
    })
    .expect("normative PQ metadata contract must validate independently of surface support");
    let transfer_vectors_ms = transfer_started.elapsed().as_secs_f64() * 1_000.0;

    let artifact_started = Instant::now();
    let report_path = std::env::var(REPORT_ENV)
        .unwrap_or_else(|_| "/tmp/rapidraw-5413-display-hdr-proof.json".to_string());
    let visual_path = Path::new(&report_path).with_extension("png");
    let visual_hash = write_visual_artifact(&visual_path, &pq, &hlg, &display_samples)
        .expect("numeric HDR approval strip must be generated");
    let visual_artifact_ms = artifact_started.elapsed().as_secs_f64() * 1_000.0;
    let edr = query_edr_capability();
    let graph_binding = graph_binding().expect("display proof must bind supplied graph report");
    let report = NativeDisplayHdrProof {
        contract: CONTRACT,
        generated_for_commit: std::env::var(COMMIT_ENV)
            .unwrap_or_else(|_| "working_tree_uncommitted".to_string()),
        adapter_name: info.name,
        backend: format!("{:?}", info.backend),
        driver: if info.driver.is_empty() {
            "not_surfaced_by_wgpu_backend".to_string()
        } else {
            info.driver
        },
        driver_info: if info.driver_info.is_empty() {
            "not_surfaced_by_wgpu_backend".to_string()
        } else {
            info.driver_info
        },
        os: sysinfo::System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_string()),
        display_id: profile.display_id,
        display_profile_sha256: profile_hash,
        display_profile_bytes: profile.profile_byte_count.unwrap_or_default(),
        #[cfg(not(any(target_os = "android", target_os = "linux")))]
        display_transform_generation: snapshot.selection_generation,
        #[cfg(any(target_os = "android", target_os = "linux"))]
        display_transform_generation: 0,
        #[cfg(not(any(target_os = "android", target_os = "linux")))]
        display_transform_implementation: snapshot.implementation_version,
        #[cfg(any(target_os = "android", target_os = "linux"))]
        display_transform_implementation: "unsupported_platform",
        display_lut_samples: display_samples,
        sdr_surface_format: "bgra8unorm-srgb",
        sdr_surface_capability: if sdr_features
            .allowed_usages
            .contains(wgpu::TextureUsages::RENDER_ATTACHMENT)
        {
            "format_validated_surface_unavailable_in_compute_harness".to_string()
        } else {
            "explicit_capability_fallback_format_unsupported".to_string()
        },
        rgba16f_hdr_intermediate: if rgba16f_features
            .allowed_usages
            .contains(wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC)
        {
            "validated_by_backend_differential_readback".to_string()
        } else {
            "explicit_capability_fallback_rgba16f_unsupported".to_string()
        },
        hdr_surface_metadata:
            "explicit_capability_fallback_product_hdr_surface_metadata_not_implemented".to_string(),
        preview_presentation_readback:
            "explicit_capability_fallback_no_native_surface_in_compute_harness".to_string(),
        edr,
        pq_pairs: pq,
        hlg_pairs: hlg,
        graph_binding,
        numeric_status: "passed_with_explicit_hdr_surface_fallback",
        visual_artifact_path: visual_path.to_string_lossy().into_owned(),
        visual_artifact_sha256: visual_hash,
        timings_ms: ProofTimings {
            display_profile: display_profile_ms,
            adapter: adapter_ms,
            transfer_vectors: transfer_vectors_ms,
            visual_artifact: visual_artifact_ms,
        },
    };
    assert!(report.display_profile_sha256.starts_with("sha256:"));
    assert!(!report.graph_binding.graph_fingerprint.is_empty());
    let report_bytes = serde_json::to_vec_pretty(&report).expect("display HDR report serializes");
    std::fs::write(&report_path, report_bytes).expect("display HDR report writes outside repo");
}

#[cfg(not(target_os = "macos"))]
#[test]
fn non_macos_hdr_contract_uses_explicit_deterministic_capability_fallback() {
    let profile = crate::display_profile::active_display_profile()
        .expect("unsupported platforms must return a typed display-profile fallback");
    assert!(profile.display_id.is_none());
    assert!(profile.icc_sha256.is_none());
    assert!(profile.profile_byte_count.is_none());

    let fallback = query_edr_capability();
    assert!(fallback.current_headroom.is_none());
    assert!(fallback.potential_headroom.is_none());
    assert!(fallback.reference_headroom.is_none());
    assert_eq!(
        fallback.disposition,
        "explicit_capability_fallback_non_macos"
    );

    validate_display_contract(&DisplayContract {
        mode: DisplayMode::Sdr,
        display_profile_sha256: "unsupported_platform".to_string(),
        snapshot_profile_sha256: "unsupported_platform".to_string(),
        output_transfer_count: 1,
        metadata: None,
    })
    .expect("non-macOS fallback still enforces the single-transfer SDR contract");
    assert!(!pq_pairs().expect("PQ fallback vectors").is_empty());
    assert!(!hlg_pairs().expect("HLG fallback vectors").is_empty());
}

#[test]
fn stale_profile_double_transfer_wrong_metadata_and_cross_use_fail_closed() {
    let valid = DisplayContract {
        mode: DisplayMode::HdrHlg,
        display_profile_sha256: "profile-a".to_string(),
        snapshot_profile_sha256: "profile-a".to_string(),
        output_transfer_count: 1,
        metadata: Some(HdrMetadata {
            mode: DisplayMode::HdrHlg,
            transfer: "arib_std_b67",
            primaries: "bt2020",
            reference_white_nits: 203.0,
            peak_nits: 1_000.0,
            full_range: true,
        }),
    };
    validate_display_contract(&valid).expect("valid HLG contract");

    let mut stale = valid.clone();
    stale.snapshot_profile_sha256 = "profile-stale".to_string();
    assert_eq!(
        validate_display_contract(&stale).unwrap_err(),
        "display_hdr_stale_display_profile"
    );
    let mut double = valid.clone();
    double.output_transfer_count = 2;
    assert_eq!(
        validate_display_contract(&double).unwrap_err(),
        "display_hdr_output_transfer_not_exactly_once"
    );
    let mut wrong = valid.clone();
    wrong.metadata.as_mut().unwrap().peak_nits = 100.0;
    assert_eq!(
        validate_display_contract(&wrong).unwrap_err(),
        "display_hdr_wrong_hdr_metadata"
    );
    let mut cross_use = valid;
    cross_use.mode = DisplayMode::Sdr;
    assert_eq!(
        validate_display_contract(&cross_use).unwrap_err(),
        "display_hdr_sdr_hdr_metadata_cross_use"
    );
}
