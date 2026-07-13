use crate::{ReferenceError, finite};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CieXyz {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl CieXyz {
    pub fn new(x: f64, y: f64, z: f64) -> Result<Self, ReferenceError> {
        finite(&[x, y, z])?;
        Ok(Self { x, y, z })
    }

    #[must_use]
    pub const fn components(self) -> [f64; 3] {
        [self.x, self.y, self.z]
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WhitePointXyz(CieXyz);

impl WhitePointXyz {
    pub fn new(x: f64, y: f64, z: f64) -> Result<Self, ReferenceError> {
        let xyz = CieXyz::new(x, y, z)?;
        if x <= 0.0 || y <= 0.0 || z <= 0.0 {
            return Err(ReferenceError::NonPositiveWhitePoint);
        }
        Ok(Self(xyz))
    }

    #[must_use]
    pub const fn xyz(self) -> CieXyz {
        self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChromaticityXyY {
    pub x: f64,
    pub y: f64,
    pub luminance_y: f64,
}

impl ChromaticityXyY {
    pub fn new(x: f64, y: f64, luminance_y: f64) -> Result<Self, ReferenceError> {
        finite(&[x, y, luminance_y])?;
        if y == 0.0 {
            return Err(ReferenceError::ZeroChromaticityY);
        }
        Ok(Self { x, y, luminance_y })
    }

    /// CIE xyY to XYZ, from CIE 15 Colorimetry: `X=xY/y`, `Z=(1-x-y)Y/y`.
    pub fn to_xyz(self) -> Result<CieXyz, ReferenceError> {
        CieXyz::new(
            self.x * self.luminance_y / self.y,
            self.luminance_y,
            (1.0 - self.x - self.y) * self.luminance_y / self.y,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LinearRgb {
    pub red: f64,
    pub green: f64,
    pub blue: f64,
}

impl LinearRgb {
    pub fn new(red: f64, green: f64, blue: f64) -> Result<Self, ReferenceError> {
        finite(&[red, green, blue])?;
        Ok(Self { red, green, blue })
    }

    #[must_use]
    pub const fn components(self) -> [f64; 3] {
        [self.red, self.green, self.blue]
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EncodedSrgb {
    pub red: f64,
    pub green: f64,
    pub blue: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EncodedRec2020 {
    pub red: f64,
    pub green: f64,
    pub blue: f64,
}

impl EncodedRec2020 {
    pub fn new(red: f64, green: f64, blue: f64) -> Result<Self, ReferenceError> {
        finite(&[red, green, blue])?;
        Ok(Self { red, green, blue })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AbsoluteLuminanceNits(f64);

impl AbsoluteLuminanceNits {
    pub fn new(value: f64) -> Result<Self, ReferenceError> {
        finite(&[value])?;
        if value < 0.0 {
            return Err(ReferenceError::NegativeLuminance);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub const fn value(self) -> f64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PqSignal(f64);

impl PqSignal {
    pub fn new(value: f64) -> Result<Self, ReferenceError> {
        finite(&[value])?;
        if value < 0.0 {
            return Err(ReferenceError::NegativeSignal);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub const fn value(self) -> f64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SceneLinearHlg(f64);

impl SceneLinearHlg {
    pub fn new(value: f64) -> Result<Self, ReferenceError> {
        finite(&[value])?;
        if value < 0.0 {
            return Err(ReferenceError::NegativeLuminance);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub const fn value(self) -> f64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HlgSignal(f64);

impl HlgSignal {
    pub fn new(value: f64) -> Result<Self, ReferenceError> {
        finite(&[value])?;
        if value < 0.0 {
            return Err(ReferenceError::NegativeSignal);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub const fn value(self) -> f64 {
        self.0
    }
}

/// BT.2124 ICtCp coordinates: dimensionless PQ intensity and signed opponent axes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ICtCp {
    pub intensity: f64,
    pub tritan: f64,
    pub protan: f64,
}

impl ICtCp {
    pub fn new(intensity: f64, tritan: f64, protan: f64) -> Result<Self, ReferenceError> {
        finite(&[intensity, tritan, protan])?;
        Ok(Self {
            intensity,
            tritan,
            protan,
        })
    }
}

/// BT.2124 ΔEITP units; 1.0 is the reference just-noticeable-difference scale.
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
pub struct DeltaEItp(f64);

impl DeltaEItp {
    pub(crate) fn new(value: f64) -> Result<Self, ReferenceError> {
        finite(&[value])?;
        Ok(Self(value))
    }

    #[must_use]
    pub const fn value(self) -> f64 {
        self.0
    }
}

impl EncodedSrgb {
    pub fn new(red: f64, green: f64, blue: f64) -> Result<Self, ReferenceError> {
        finite(&[red, green, blue])?;
        Ok(Self { red, green, blue })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CieLab {
    pub lightness: f64,
    pub a: f64,
    pub b: f64,
}

impl CieLab {
    pub fn new(lightness: f64, a: f64, b: f64) -> Result<Self, ReferenceError> {
        finite(&[lightness, a, b])?;
        Ok(Self { lightness, a, b })
    }
}
