//! Deterministic, repository-owned synthetic color-quality fixtures.

use sha2::{Digest, Sha256};

use crate::{
    ReferenceError,
    transfer::{hlg_oetf, pq_inverse_eotf},
    types::{AbsoluteLuminanceNits, SceneLinearHlg},
};

pub const FIXTURE_GENERATOR_CONTRACT_ID: &str = "rapidraw.color-reference.fixtures.v1";
pub const FIXTURE_GENERATOR_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FixtureLicense {
    Agpl3OrLater,
}

impl FixtureLicense {
    #[must_use]
    pub const fn spdx(self) -> &'static str {
        match self {
            Self::Agpl3OrLater => "AGPL-3.0-or-later",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FixtureDomain {
    SceneLinearRgb,
    CieLabPolar,
    ScalarLinear,
    SensorMosaic,
    SpatialLinear,
    PqAbsoluteLuminance,
    HlgSceneLinear,
    Rec2100AbsoluteRgb,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FixtureUnits {
    RelativeLinearLight,
    LabUnitsAndDegrees,
    Normalized,
    SensorCodeValue,
    RelativeLinearLightPerPixel,
    AbsoluteNitsAndPqSignal,
    HlgSceneLinearAndSignal,
    AbsoluteNits,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SemanticColorClass {
    Skin,
    Sky,
    Foliage,
    Neon,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CfaPattern {
    BayerRggb,
    XTrans6x6,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpatialPattern {
    StepEdge,
    LinearWedge,
    FrequencyBands,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FixtureId {
    NeutralExtendedRamp,
    HueChromaLuminanceSweep,
    SemanticCloud(SemanticColorClass),
    SmoothGradient,
    Cfa(CfaPattern),
    Spatial(SpatialPattern),
    PqRamp,
    HlgRamp,
    Rec2100HdrColors,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FixtureShape {
    pub width: usize,
    pub height: usize,
    pub channels: usize,
    pub samples: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContentHash([u8; 32]);

impl ContentHash {
    #[must_use]
    pub fn to_hex(self) -> String {
        self.0.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FixtureManifest {
    pub contract_id: &'static str,
    pub generator_version: u32,
    pub id: FixtureId,
    pub domain: FixtureDomain,
    pub units: FixtureUnits,
    pub license: FixtureLicense,
    pub shape: FixtureShape,
    pub content_hash: ContentHash,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RgbSample {
    pub red: f64,
    pub green: f64,
    pub blue: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PolarLabSample {
    pub lightness: f64,
    pub chroma: f64,
    pub hue_degrees: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SemanticColorSample {
    pub class: SemanticColorClass,
    pub rgb: RgbSample,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CfaFixture {
    pub pattern: CfaPattern,
    pub width: usize,
    pub height: usize,
    pub samples: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SpatialFixture {
    pub pattern: SpatialPattern,
    pub samples: Vec<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TransferSample {
    pub input: f64,
    pub encoded: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum FixtureData {
    Rgb(Vec<RgbSample>),
    PolarLab(Vec<PolarLabSample>),
    SemanticCloud(Vec<SemanticColorSample>),
    Scalar(Vec<f64>),
    Cfa(CfaFixture),
    Spatial(SpatialFixture),
    Transfer(Vec<TransferSample>),
}

#[derive(Clone, Debug, PartialEq)]
pub struct FixturePack {
    pub manifest: FixtureManifest,
    pub data: FixtureData,
}

impl FixturePack {
    #[must_use]
    pub fn computed_hash(&self) -> ContentHash {
        canonical_hash(
            self.manifest.id,
            self.manifest.domain,
            self.manifest.units,
            self.manifest.shape,
            &self.data,
        )
    }

    #[must_use]
    pub fn hash_is_current(&self) -> bool {
        self.manifest.content_hash == self.computed_hash()
    }

    #[must_use]
    pub fn shape_is_current(&self) -> bool {
        self.manifest.shape == data_shape(&self.data)
    }
}

pub fn generate_fixture_packs() -> Result<Vec<FixturePack>, ReferenceError> {
    let mut packs = vec![
        pack(
            FixtureId::NeutralExtendedRamp,
            FixtureDomain::SceneLinearRgb,
            FixtureUnits::RelativeLinearLight,
            FixtureShape {
                width: 51,
                height: 1,
                channels: 3,
                samples: 51,
            },
            FixtureData::Rgb(neutral_extended_ramp()),
        ),
        pack(
            FixtureId::HueChromaLuminanceSweep,
            FixtureDomain::CieLabPolar,
            FixtureUnits::LabUnitsAndDegrees,
            FixtureShape {
                width: 12,
                height: 12,
                channels: 3,
                samples: 144,
            },
            FixtureData::PolarLab(hue_chroma_luminance_sweep()),
        ),
        pack(
            FixtureId::SmoothGradient,
            FixtureDomain::ScalarLinear,
            FixtureUnits::RelativeLinearLight,
            FixtureShape {
                width: 257,
                height: 1,
                channels: 1,
                samples: 257,
            },
            FixtureData::Scalar(smooth_gradient()),
        ),
    ];
    for class in [
        SemanticColorClass::Skin,
        SemanticColorClass::Sky,
        SemanticColorClass::Foliage,
        SemanticColorClass::Neon,
    ] {
        packs.push(pack(
            FixtureId::SemanticCloud(class),
            FixtureDomain::SceneLinearRgb,
            FixtureUnits::RelativeLinearLight,
            FixtureShape {
                width: 9,
                height: 1,
                channels: 3,
                samples: 9,
            },
            FixtureData::SemanticCloud(semantic_cloud(class)),
        ));
    }
    for pattern in [CfaPattern::BayerRggb, CfaPattern::XTrans6x6] {
        let cfa = generate_cfa(pattern);
        packs.push(pack(
            FixtureId::Cfa(pattern),
            FixtureDomain::SensorMosaic,
            FixtureUnits::SensorCodeValue,
            FixtureShape {
                width: cfa.width,
                height: cfa.height,
                channels: 1,
                samples: cfa.samples.len(),
            },
            FixtureData::Cfa(cfa),
        ));
    }
    for pattern in [
        SpatialPattern::StepEdge,
        SpatialPattern::LinearWedge,
        SpatialPattern::FrequencyBands,
    ] {
        let spatial = generate_spatial(pattern);
        packs.push(pack(
            FixtureId::Spatial(pattern),
            FixtureDomain::SpatialLinear,
            FixtureUnits::RelativeLinearLightPerPixel,
            FixtureShape {
                width: spatial.samples.len(),
                height: 1,
                channels: 1,
                samples: spatial.samples.len(),
            },
            FixtureData::Spatial(spatial),
        ));
    }
    let pq = pq_ramp()?;
    packs.push(pack(
        FixtureId::PqRamp,
        FixtureDomain::PqAbsoluteLuminance,
        FixtureUnits::AbsoluteNitsAndPqSignal,
        FixtureShape {
            width: pq.len(),
            height: 1,
            channels: 2,
            samples: pq.len(),
        },
        FixtureData::Transfer(pq),
    ));
    let hlg = hlg_ramp()?;
    packs.push(pack(
        FixtureId::HlgRamp,
        FixtureDomain::HlgSceneLinear,
        FixtureUnits::HlgSceneLinearAndSignal,
        FixtureShape {
            width: hlg.len(),
            height: 1,
            channels: 2,
            samples: hlg.len(),
        },
        FixtureData::Transfer(hlg),
    ));
    let hdr_colors = rec2100_hdr_colors();
    packs.push(pack(
        FixtureId::Rec2100HdrColors,
        FixtureDomain::Rec2100AbsoluteRgb,
        FixtureUnits::AbsoluteNits,
        FixtureShape {
            width: hdr_colors.len(),
            height: 1,
            channels: 3,
            samples: hdr_colors.len(),
        },
        FixtureData::Rgb(hdr_colors),
    ));
    Ok(packs)
}

fn rec2100_hdr_colors() -> Vec<RgbSample> {
    [
        [0.0, 0.0, 0.0],
        [0.1, 0.1, 0.1],
        [100.0, 100.0, 100.0],
        [203.0, 203.0, 203.0],
        [1_000.0, 1_000.0, 1_000.0],
        [10_000.0, 10_000.0, 10_000.0],
        [1_000.0, 0.0, 0.0],
        [0.0, 1_000.0, 0.0],
        [0.0, 0.0, 1_000.0],
        [600.0, 120.0, 20.0],
    ]
    .map(|[red, green, blue]| RgbSample { red, green, blue })
    .to_vec()
}

fn pack(
    id: FixtureId,
    domain: FixtureDomain,
    units: FixtureUnits,
    shape: FixtureShape,
    data: FixtureData,
) -> FixturePack {
    let content_hash = canonical_hash(id, domain, units, shape, &data);
    FixturePack {
        manifest: FixtureManifest {
            contract_id: FIXTURE_GENERATOR_CONTRACT_ID,
            generator_version: FIXTURE_GENERATOR_VERSION,
            id,
            domain,
            units,
            license: FixtureLicense::Agpl3OrLater,
            shape,
            content_hash,
        },
        data,
    }
}

fn neutral_extended_ramp() -> Vec<RgbSample> {
    let mut values = Vec::with_capacity(51);
    for exponent in (-16..=0).rev() {
        let value = -2_f64.powi(exponent);
        values.push(RgbSample {
            red: value,
            green: value,
            blue: value,
        });
    }
    values.push(RgbSample {
        red: 0.0,
        green: 0.0,
        blue: 0.0,
    });
    for exponent in -16..=16 {
        let value = 2_f64.powi(exponent);
        values.push(RgbSample {
            red: value,
            green: value,
            blue: value,
        });
    }
    values
}

fn hue_chroma_luminance_sweep() -> Vec<PolarLabSample> {
    let mut samples = Vec::with_capacity(144);
    for lightness in [10.0, 50.0, 90.0] {
        for chroma in [0.0, 20.0, 40.0, 80.0] {
            for hue in (0..360).step_by(30) {
                samples.push(PolarLabSample {
                    lightness,
                    chroma,
                    hue_degrees: hue as f64,
                });
            }
        }
    }
    samples
}

fn semantic_cloud(class: SemanticColorClass) -> Vec<SemanticColorSample> {
    let base = match class {
        SemanticColorClass::Skin => [0.55, 0.28, 0.18],
        SemanticColorClass::Sky => [0.12, 0.35, 0.75],
        SemanticColorClass::Foliage => [0.16, 0.46, 0.10],
        SemanticColorClass::Neon => [1.40, -0.08, 2.20],
    };
    let offsets = [-0.04, 0.0, 0.04];
    let mut samples = Vec::with_capacity(9);
    for red_offset in offsets {
        for green_offset in offsets {
            let blue_offset = -(red_offset + green_offset) / 2.0;
            samples.push(SemanticColorSample {
                class,
                rgb: RgbSample {
                    red: base[0] + red_offset,
                    green: base[1] + green_offset,
                    blue: base[2] + blue_offset,
                },
            });
        }
    }
    samples
}

fn smooth_gradient() -> Vec<f64> {
    (0..=256)
        .map(|index| -1.0 + 3.0 * index as f64 / 256.0)
        .collect()
}

fn generate_cfa(pattern: CfaPattern) -> CfaFixture {
    let (width, height) = match pattern {
        CfaPattern::BayerRggb => (8, 8),
        CfaPattern::XTrans6x6 => (12, 12),
    };
    let mut samples = Vec::with_capacity(width * height);
    for y in 0..height {
        for x in 0..width {
            let rgb = [
                (x + 1) as f64 / (width + 1) as f64,
                (y + 1) as f64 / (height + 1) as f64,
                (x + y + 2) as f64 / (width + height + 2) as f64,
            ];
            samples.push(rgb[cfa_channel(pattern, x, y)]);
        }
    }
    CfaFixture {
        pattern,
        width,
        height,
        samples,
    }
}

fn cfa_channel(pattern: CfaPattern, x: usize, y: usize) -> usize {
    match pattern {
        CfaPattern::BayerRggb => match (y % 2, x % 2) {
            (0, 0) => 0,
            (1, 1) => 2,
            _ => 1,
        },
        CfaPattern::XTrans6x6 => {
            const XTRANS: [[usize; 6]; 6] = [
                [1, 0, 1, 1, 0, 1],
                [2, 1, 2, 0, 1, 0],
                [1, 0, 1, 1, 0, 1],
                [1, 2, 1, 1, 2, 1],
                [0, 1, 0, 2, 1, 2],
                [1, 2, 1, 1, 2, 1],
            ];
            XTRANS[y % 6][x % 6]
        }
    }
}

fn generate_spatial(pattern: SpatialPattern) -> SpatialFixture {
    let samples = match pattern {
        SpatialPattern::StepEdge => (0..64)
            .map(|index| if index >= 32 { 1.0 } else { 0.0 })
            .collect(),
        SpatialPattern::LinearWedge => (0..64).map(|index| index as f64 / 63.0).collect(),
        SpatialPattern::FrequencyBands => {
            const WAVE: [f64; 8] = [0.0, 0.5, 1.0, 0.5, 0.0, -0.5, -1.0, -0.5];
            (0..64)
                .map(|index| WAVE[(index * (1 + index / 16)) % WAVE.len()])
                .collect()
        }
    };
    SpatialFixture { pattern, samples }
}

fn pq_ramp() -> Result<Vec<TransferSample>, ReferenceError> {
    (0..=64)
        .map(|index| {
            let input = 10_000.0 * index as f64 / 64.0;
            let encoded = pq_inverse_eotf(AbsoluteLuminanceNits::new(input)?)?.value();
            Ok(TransferSample { input, encoded })
        })
        .collect()
}

fn hlg_ramp() -> Result<Vec<TransferSample>, ReferenceError> {
    (0..=64)
        .map(|index| {
            let input = 2.0 * index as f64 / 64.0;
            let encoded = hlg_oetf(SceneLinearHlg::new(input)?)?.value();
            Ok(TransferSample { input, encoded })
        })
        .collect()
}

fn canonical_hash(
    id: FixtureId,
    domain: FixtureDomain,
    units: FixtureUnits,
    shape: FixtureShape,
    data: &FixtureData,
) -> ContentHash {
    let mut hash = Sha256::new();
    hash.update(FIXTURE_GENERATOR_CONTRACT_ID.as_bytes());
    hash.update(FIXTURE_GENERATOR_VERSION.to_le_bytes());
    hash.update([fixture_id_tag(id), domain as u8, units as u8]);
    if let FixtureId::SemanticCloud(class) = id {
        hash.update([class as u8]);
    }
    if let FixtureId::Cfa(pattern) = id {
        hash.update([pattern as u8]);
    }
    if let FixtureId::Spatial(pattern) = id {
        hash.update([pattern as u8]);
    }
    for dimension in [shape.width, shape.height, shape.channels, shape.samples] {
        hash.update((dimension as u64).to_le_bytes());
    }
    hash_data(&mut hash, data);
    ContentHash(hash.finalize().into())
}

fn fixture_id_tag(id: FixtureId) -> u8 {
    match id {
        FixtureId::NeutralExtendedRamp => 0,
        FixtureId::HueChromaLuminanceSweep => 1,
        FixtureId::SemanticCloud(_) => 2,
        FixtureId::SmoothGradient => 3,
        FixtureId::Cfa(_) => 4,
        FixtureId::Spatial(_) => 5,
        FixtureId::PqRamp => 6,
        FixtureId::HlgRamp => 7,
        FixtureId::Rec2100HdrColors => 8,
    }
}

fn data_shape(data: &FixtureData) -> FixtureShape {
    match data {
        FixtureData::Rgb(samples) => FixtureShape {
            width: samples.len(),
            height: 1,
            channels: 3,
            samples: samples.len(),
        },
        FixtureData::PolarLab(samples) => FixtureShape {
            width: 12,
            height: samples.len() / 12,
            channels: 3,
            samples: samples.len(),
        },
        FixtureData::SemanticCloud(samples) => FixtureShape {
            width: samples.len(),
            height: 1,
            channels: 3,
            samples: samples.len(),
        },
        FixtureData::Scalar(samples) => FixtureShape {
            width: samples.len(),
            height: 1,
            channels: 1,
            samples: samples.len(),
        },
        FixtureData::Cfa(fixture) => FixtureShape {
            width: fixture.width,
            height: fixture.height,
            channels: 1,
            samples: fixture.samples.len(),
        },
        FixtureData::Spatial(fixture) => FixtureShape {
            width: fixture.samples.len(),
            height: 1,
            channels: 1,
            samples: fixture.samples.len(),
        },
        FixtureData::Transfer(samples) => FixtureShape {
            width: samples.len(),
            height: 1,
            channels: 2,
            samples: samples.len(),
        },
    }
}

fn hash_f64(hash: &mut Sha256, value: f64) {
    hash.update(value.to_bits().to_le_bytes());
}

fn hash_data(hash: &mut Sha256, data: &FixtureData) {
    match data {
        FixtureData::Rgb(samples) => {
            hash.update([0]);
            for sample in samples {
                for value in [sample.red, sample.green, sample.blue] {
                    hash_f64(hash, value);
                }
            }
        }
        FixtureData::PolarLab(samples) => {
            hash.update([1]);
            for sample in samples {
                for value in [sample.lightness, sample.chroma, sample.hue_degrees] {
                    hash_f64(hash, value);
                }
            }
        }
        FixtureData::SemanticCloud(samples) => {
            hash.update([2]);
            for sample in samples {
                hash.update([sample.class as u8]);
                for value in [sample.rgb.red, sample.rgb.green, sample.rgb.blue] {
                    hash_f64(hash, value);
                }
            }
        }
        FixtureData::Scalar(samples) => {
            hash.update([3]);
            for &value in samples {
                hash_f64(hash, value);
            }
        }
        FixtureData::Cfa(fixture) => {
            hash.update([4, fixture.pattern as u8]);
            for &value in &fixture.samples {
                hash_f64(hash, value);
            }
        }
        FixtureData::Spatial(fixture) => {
            hash.update([5, fixture.pattern as u8]);
            for &value in &fixture.samples {
                hash_f64(hash, value);
            }
        }
        FixtureData::Transfer(samples) => {
            hash.update([6]);
            for sample in samples {
                hash_f64(hash, sample.input);
                hash_f64(hash, sample.encoded);
            }
        }
    }
}
