use std::collections::HashSet;

use rapidraw_color_reference::{
    fixtures::{
        CfaPattern, FIXTURE_GENERATOR_CONTRACT_ID, FixtureData, FixtureId, FixtureLicense,
        SemanticColorClass, SpatialPattern, generate_fixture_packs,
    },
    metrics::{
        DetailMetricCondition, DetailSignalDomain, ToneInputDomain, ToneMetricCondition,
        ToneOutputDomain, ToneSample, measure_detail_signal, measure_tone_curve,
    },
};

fn fixture(id: FixtureId) -> rapidraw_color_reference::fixtures::FixturePack {
    generate_fixture_packs()
        .unwrap()
        .into_iter()
        .find(|pack| pack.manifest.id == id)
        .unwrap()
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual={actual:.12} expected={expected:.12}"
    );
}

#[test]
fn fixture_generation_is_bit_deterministic_and_manifests_are_complete() {
    let first = generate_fixture_packs().unwrap();
    let second = generate_fixture_packs().unwrap();
    assert_eq!(first, second);
    assert_eq!(first.len(), 16);
    assert_eq!(
        first[0].manifest.content_hash.to_hex(),
        "dc6cde97ae4f9c2f18fbf114e894852cf70c654cd156559502eab7588b4bdf0a"
    );
    let hashes: HashSet<String> = first
        .iter()
        .map(|pack| {
            assert!(pack.hash_is_current());
            assert!(pack.shape_is_current());
            assert_eq!(pack.manifest.contract_id, FIXTURE_GENERATOR_CONTRACT_ID);
            assert_eq!(pack.manifest.generator_version, 1);
            assert_eq!(pack.manifest.license, FixtureLicense::Agpl3OrLater);
            assert_eq!(pack.manifest.license.spdx(), "AGPL-3.0-or-later");
            assert!(pack.manifest.shape.samples > 0);
            let hash = pack.manifest.content_hash.to_hex();
            assert_eq!(hash.len(), 64);
            hash
        })
        .collect();
    assert_eq!(hashes.len(), first.len());
}

#[test]
fn canonical_hash_changes_when_fixture_pixels_change() {
    let mut ramp = fixture(FixtureId::NeutralExtendedRamp);
    let original_hash = ramp.manifest.content_hash;
    let FixtureData::Rgb(samples) = &mut ramp.data else {
        panic!("neutral ramp must contain RGB samples");
    };
    samples[10].green += f64::EPSILON;
    assert_ne!(ramp.computed_hash(), original_hash);
    assert!(!ramp.hash_is_current());
}

#[test]
fn extended_color_fixtures_cover_negative_highlight_and_semantic_cloud_domains() {
    let neutral = fixture(FixtureId::NeutralExtendedRamp);
    let FixtureData::Rgb(samples) = neutral.data else {
        panic!("neutral ramp must contain RGB samples");
    };
    assert_eq!(samples.len(), 51);
    close(samples.first().unwrap().red, -1.0, 0.0);
    close(samples.last().unwrap().red, 65_536.0, 0.0);
    assert!(samples.iter().any(|sample| sample.red < 0.0));
    assert!(samples.iter().any(|sample| sample.red == 0.0));
    assert!(
        samples
            .iter()
            .all(|sample| sample.red == sample.green && sample.green == sample.blue)
    );

    let sweep = fixture(FixtureId::HueChromaLuminanceSweep);
    let FixtureData::PolarLab(samples) = sweep.data else {
        panic!("sweep must contain polar Lab samples");
    };
    assert_eq!(samples.len(), 144);
    assert!(
        samples
            .iter()
            .any(|sample| sample.hue_degrees == 330.0 && sample.chroma == 80.0)
    );
    assert!(samples.iter().any(|sample| sample.lightness == 10.0));
    assert!(samples.iter().any(|sample| sample.lightness == 90.0));

    for class in [
        SemanticColorClass::Skin,
        SemanticColorClass::Sky,
        SemanticColorClass::Foliage,
        SemanticColorClass::Neon,
    ] {
        let cloud = fixture(FixtureId::SemanticCloud(class));
        let FixtureData::SemanticCloud(samples) = cloud.data else {
            panic!("semantic fixture must contain a cloud");
        };
        assert_eq!(samples.len(), 9);
        assert!(samples.iter().all(|sample| sample.class == class));
        if class == SemanticColorClass::Neon {
            assert!(samples.iter().any(|sample| sample.rgb.red > 1.0));
            assert!(samples.iter().any(|sample| sample.rgb.green < 0.0));
        }
    }
}

#[test]
fn rec2100_hdr_fixture_covers_absolute_neutrals_primaries_and_mixed_color() {
    let FixtureData::Rgb(samples) = fixture(FixtureId::Rec2100HdrColors).data else {
        panic!("Rec.2100 HDR fixture must contain RGB samples");
    };
    assert_eq!(samples.len(), 10);
    assert!(samples.iter().any(|sample| sample.red == 10_000.0));
    assert!(
        samples
            .iter()
            .any(|sample| { sample.red == 1_000.0 && sample.green == 0.0 && sample.blue == 0.0 })
    );
    assert!(samples.iter().any(|sample| {
        sample.red != sample.green && sample.green != sample.blue && sample.blue != sample.red
    }));
}

#[test]
fn d50_xyz_fixture_covers_reference_white_negative_and_over_range_values() {
    let FixtureData::Rgb(samples) = fixture(FixtureId::D50XyzVectors).data else {
        panic!("D50 XYZ fixture must contain tristimulus samples");
    };
    assert_eq!(samples.len(), 7);
    assert!(
        samples.iter().any(|sample| {
            sample.red == 0.96422 && sample.green == 1.0 && sample.blue == 0.82521
        })
    );
    assert!(samples.iter().any(|sample| sample.red < 0.0));
    assert!(samples.iter().any(|sample| sample.green > 1.0));
}

#[test]
fn cfa_generators_sample_declared_bayer_and_xtrans_channels() {
    let bayer = fixture(FixtureId::Cfa(CfaPattern::BayerRggb));
    let FixtureData::Cfa(bayer) = bayer.data else {
        panic!("Bayer fixture must contain CFA samples");
    };
    assert_eq!((bayer.width, bayer.height, bayer.samples.len()), (8, 8, 64));
    close(bayer.samples[0], 1.0 / 9.0, 0.0);
    close(bayer.samples[1], 1.0 / 9.0, 0.0);
    close(bayer.samples[9], 2.0 / 9.0, 0.0);

    let xtrans = fixture(FixtureId::Cfa(CfaPattern::XTrans6x6));
    let FixtureData::Cfa(xtrans) = xtrans.data else {
        panic!("X-Trans fixture must contain CFA samples");
    };
    assert_eq!(
        (xtrans.width, xtrans.height, xtrans.samples.len()),
        (12, 12, 144)
    );
    close(xtrans.samples[0], 1.0 / 13.0, 0.0);
    close(xtrans.samples[1], 2.0 / 13.0, 0.0);
    close(xtrans.samples[12], 3.0 / 26.0, 0.0);
}

#[test]
fn generated_gradient_and_hdr_ramps_are_metric_ready_and_detect_injected_reversals() {
    let gradient = fixture(FixtureId::SmoothGradient);
    let FixtureData::Scalar(samples) = gradient.data else {
        panic!("gradient must contain scalar samples");
    };
    let mut tone: Vec<ToneSample> = samples
        .iter()
        .enumerate()
        .map(|(index, &output)| ToneSample::new(index as f64, output).unwrap())
        .collect();
    let condition = ToneMetricCondition::new(
        ToneInputDomain::Normalized,
        ToneOutputDomain::SceneLinear,
        0.0,
        0.1,
    )
    .unwrap();
    assert_eq!(
        measure_tone_curve(&tone, condition)
            .unwrap()
            .monotonicity_violations,
        0
    );
    tone[129].output = tone[127].output - 0.1;
    assert!(
        measure_tone_curve(&tone, condition)
            .unwrap()
            .monotonicity_violations
            > 0
    );

    for id in [FixtureId::PqRamp, FixtureId::HlgRamp] {
        let FixtureData::Transfer(samples) = fixture(id).data else {
            panic!("HDR ramp must contain transfer samples");
        };
        let tone: Vec<ToneSample> = samples
            .iter()
            .map(|sample| ToneSample::new(sample.input, sample.encoded).unwrap())
            .collect();
        assert_eq!(
            measure_tone_curve(&tone, condition)
                .unwrap()
                .monotonicity_violations,
            0
        );
        assert!(
            samples
                .windows(2)
                .all(|pair| pair[1].encoded > pair[0].encoded)
        );
    }
}

#[test]
fn generated_spatial_edge_drives_detail_metrics_and_detects_injected_artifacts() {
    let edge = fixture(FixtureId::Spatial(SpatialPattern::StepEdge));
    let FixtureData::Spatial(edge) = edge.data else {
        panic!("edge fixture must contain spatial samples");
    };
    let condition =
        DetailMetricCondition::new(DetailSignalDomain::LinearLight, 1.0, 32, 4, 1e-12, vec![48])
            .unwrap();
    let clean = measure_detail_signal(&edge.samples, &edge.samples, &condition).unwrap();
    assert_eq!(clean.overshoot, 0.0);
    let mut corrupted = edge.samples.clone();
    corrupted[30] = -0.1;
    corrupted[31] = 0.1;
    corrupted[32] = 1.2;
    corrupted[33] = 0.9;
    corrupted[48] = 1.3;
    let detected = measure_detail_signal(&edge.samples, &corrupted, &condition).unwrap();
    assert!(detected.overshoot > 0.0);
    assert!(detected.undershoot > 0.0);
    assert!(detected.halo_amplitude > 0.0);
    assert!(detected.ringing_sign_changes >= 2);
    assert!(detected.maximum_tile_seam_error > 0.0);

    for pattern in [SpatialPattern::LinearWedge, SpatialPattern::FrequencyBands] {
        let FixtureData::Spatial(spatial) = fixture(FixtureId::Spatial(pattern)).data else {
            panic!("spatial fixture must contain samples");
        };
        assert_eq!(spatial.samples.len(), 64);
    }
}
