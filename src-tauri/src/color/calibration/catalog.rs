use super::PatchRole;
use anyhow::{Result, anyhow};

#[derive(Debug, Clone)]
pub(crate) struct ReferencePatch {
    pub id: &'static str,
    pub role: PatchRole,
    pub xyz_d65: [f64; 3],
}

#[derive(Debug, Clone)]
pub(crate) struct ChartDefinition {
    pub id: &'static str,
    pub version: u32,
    pub rows: usize,
    pub columns: usize,
    pub reference_illuminant: &'static str,
    pub observer: &'static str,
    pub provenance: &'static str,
    pub license_id: &'static str,
    pub source_url: &'static str,
    pub patches: Vec<ReferencePatch>,
}

const PATCH_IDS: [&str; 24] = [
    "dark_skin",
    "light_skin",
    "blue_sky",
    "foliage",
    "blue_flower",
    "bluish_green",
    "orange",
    "purplish_blue",
    "moderate_red",
    "purple",
    "yellow_green",
    "orange_yellow",
    "blue",
    "green",
    "red",
    "yellow",
    "magenta",
    "cyan",
    "white_95",
    "neutral_80",
    "neutral_65",
    "neutral_50",
    "neutral_35",
    "black_20",
];

// CC0 ColorChecker Classic sRGB/D65 values from the Wikimedia Commons source
// below. Numeric reference data only; no chart artwork or proprietary profile
// asset is bundled.
const COLORCHECKER_SRGB8: [[u8; 3]; 24] = [
    [115, 82, 68],
    [194, 150, 130],
    [98, 122, 157],
    [87, 108, 67],
    [133, 128, 177],
    [103, 189, 170],
    [214, 126, 44],
    [80, 91, 166],
    [193, 90, 99],
    [94, 60, 108],
    [157, 188, 64],
    [224, 163, 46],
    [56, 61, 150],
    [70, 148, 73],
    [175, 54, 60],
    [231, 199, 31],
    [187, 86, 149],
    [8, 133, 161],
    [243, 243, 242],
    [200, 200, 200],
    [160, 160, 160],
    [122, 122, 121],
    [85, 85, 85],
    [52, 52, 52],
];

pub(crate) fn chart_definition(id: &str) -> Result<ChartDefinition> {
    if id != "colorchecker_classic_24_cc0_srgb_d65_v1" {
        return Err(anyhow!("chart_calibration_unknown_chart_definition"));
    }
    let patches = COLORCHECKER_SRGB8
        .iter()
        .enumerate()
        .map(|(index, rgb)| ReferencePatch {
            id: PATCH_IDS[index],
            role: if index >= 18 {
                PatchRole::Neutral
            } else if index <= 1 {
                PatchRole::Skin
            } else {
                PatchRole::Chromatic
            },
            xyz_d65: linear_srgb_to_xyz(rgb.map(linearize_srgb8)),
        })
        .collect();
    Ok(ChartDefinition {
        id: "colorchecker_classic_24_cc0_srgb_d65_v1",
        version: 1,
        rows: 4,
        columns: 6,
        reference_illuminant: "D65",
        observer: "CIE 1931 2 degree",
        provenance: "Wikimedia Commons Color Checker.svg sRGB/D65 numeric values, revision 2025-06-27",
        license_id: "CC0-1.0",
        source_url: "https://commons.wikimedia.org/wiki/File:Color_Checker.svg",
        patches,
    })
}

fn linearize_srgb8(value: u8) -> f64 {
    let normalized = f64::from(value) / 255.0;
    if normalized <= 0.04045 {
        normalized / 12.92
    } else {
        ((normalized + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_srgb_to_xyz(rgb: [f64; 3]) -> [f64; 3] {
    [
        0.412_456_4 * rgb[0] + 0.357_576_1 * rgb[1] + 0.180_437_5 * rgb[2],
        0.212_672_9 * rgb[0] + 0.715_152_2 * rgb[1] + 0.072_175 * rgb[2],
        0.019_333_9 * rgb[0] + 0.119_192 * rgb[1] + 0.950_304_1 * rgb[2],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_explicit_complete_and_neutral_ordered() {
        let chart = chart_definition("colorchecker_classic_24_cc0_srgb_d65_v1").unwrap();
        assert_eq!(chart.rows * chart.columns, chart.patches.len());
        assert_eq!(chart.license_id, "CC0-1.0");
        assert!(
            chart
                .source_url
                .starts_with("https://commons.wikimedia.org/")
        );
        assert_eq!(
            chart
                .patches
                .iter()
                .filter(|patch| patch.role == PatchRole::Neutral)
                .count(),
            6
        );
        assert!(
            chart
                .patches
                .iter()
                .all(|patch| patch.xyz_d65.iter().all(|value| value.is_finite()))
        );
        assert!(chart_definition("arbitrary-chart").is_err());
    }
}
