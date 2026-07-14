use serde::Serialize;

use crate::color::hdr_editing::HdrEditingPlanV1;

const SCOPE_RESOLUTION: usize = 256;
const AP1_LUMA: [f32; 3] = [0.272_228_72, 0.674_081_74, 0.053_689_52];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HdrScopeRenditionV1 {
    SceneHdrView,
    DisplayPresentation,
    SdrRendition,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdrScopeAxisV1 {
    pub min_stops_from_sdr_white: f32,
    pub max_stops_from_sdr_white: f32,
    pub peak_row: u16,
    pub reference_white_row: u16,
    pub target_peak_linear: f32,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdrClippingStatsV1 {
    pub at_or_above_peak_pixels: u64,
    pub below_zero_pixels: u64,
    pub hdr_pixels: u64,
    pub non_finite_source_pixels: u64,
    pub over_peak_pixels: u64,
    pub total_pixels: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdrScopesReceiptV1 {
    pub capability_generation: u64,
    pub histogram_blue: Vec<u32>,
    pub histogram_green: Vec<u32>,
    pub histogram_luma: Vec<u32>,
    pub histogram_red: Vec<u32>,
    pub plan_fingerprint: String,
    pub rendition: HdrScopeRenditionV1,
    pub scene_edit_fingerprint: String,
    pub scope_axis: HdrScopeAxisV1,
    pub stats: HdrClippingStatsV1,
    pub view_fingerprint: String,
    pub waveform_luma: Vec<u32>,
    pub waveform_resolution: u16,
}

pub fn analyze_hdr_scopes(
    plan: &HdrEditingPlanV1,
    scene_ap1: &[[f32; 3]],
    width: u32,
    height: u32,
    rendition: HdrScopeRenditionV1,
) -> Result<HdrScopesReceiptV1, String> {
    let expected = usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .ok_or_else(|| "hdr_scopes_dimensions_overflow".to_string())?;
    if expected == 0 || scene_ap1.len() != expected {
        return Err("hdr_scopes_pixel_count_mismatch".to_string());
    }

    let view = match rendition {
        HdrScopeRenditionV1::SceneHdrView => plan.hdr_view,
        HdrScopeRenditionV1::DisplayPresentation => plan.presentation_view,
        HdrScopeRenditionV1::SdrRendition => plan.sdr_view,
    };
    let peak = view.target_white_linear.max(1.0);
    let min_stops = -10.0_f32;
    let max_stops = peak.log2().ceil().max(0.0) + 1.0;
    let row_for = |value: f32| -> usize {
        let stops = value.max(2.0_f32.powf(min_stops)).log2();
        (((stops - min_stops) / (max_stops - min_stops)) * (SCOPE_RESOLUTION - 1) as f32)
            .round()
            .clamp(0.0, (SCOPE_RESOLUTION - 1) as f32) as usize
    };
    let mut red = vec![0_u32; SCOPE_RESOLUTION];
    let mut green = vec![0_u32; SCOPE_RESOLUTION];
    let mut blue = vec![0_u32; SCOPE_RESOLUTION];
    let mut luma = vec![0_u32; SCOPE_RESOLUTION];
    let mut waveform = vec![0_u32; SCOPE_RESOLUTION * SCOPE_RESOLUTION];
    let mut stats = HdrClippingStatsV1 {
        total_pixels: expected as u64,
        ..Default::default()
    };

    for (index, source) in scene_ap1.iter().copied().enumerate() {
        if source.iter().any(|channel| !channel.is_finite()) {
            stats.non_finite_source_pixels += 1;
        }
        let pixel = view.apply_rgb(source);
        if pixel.iter().any(|channel| *channel < 0.0) {
            stats.below_zero_pixels += 1;
        }
        let value =
            (pixel[0] * AP1_LUMA[0] + pixel[1] * AP1_LUMA[1] + pixel[2] * AP1_LUMA[2]).max(0.0);
        if value > 1.0 {
            stats.hdr_pixels += 1;
        }
        if value >= peak * (1.0 - 1.0e-6) {
            stats.at_or_above_peak_pixels += 1;
        }
        if value > peak * (1.0 + 1.0e-6) {
            stats.over_peak_pixels += 1;
        }
        red[row_for(pixel[0].max(0.0))] += 1;
        green[row_for(pixel[1].max(0.0))] += 1;
        blue[row_for(pixel[2].max(0.0))] += 1;
        let row = row_for(value);
        luma[row] += 1;
        let x = (index % width as usize) * SCOPE_RESOLUTION / width as usize;
        waveform[(SCOPE_RESOLUTION - 1 - row) * SCOPE_RESOLUTION + x] += 1;
    }

    Ok(HdrScopesReceiptV1 {
        capability_generation: plan.presentation_target.capability_generation,
        histogram_blue: blue,
        histogram_green: green,
        histogram_luma: luma,
        histogram_red: red,
        plan_fingerprint: format!("{:016x}", plan.plan_fingerprint),
        rendition,
        scene_edit_fingerprint: format!("{:016x}", plan.scene_edit_fingerprint),
        scope_axis: HdrScopeAxisV1 {
            min_stops_from_sdr_white: min_stops,
            max_stops_from_sdr_white: max_stops,
            peak_row: row_for(peak) as u16,
            reference_white_row: row_for(1.0) as u16,
            target_peak_linear: peak,
        },
        stats,
        view_fingerprint: format!("{:016x}", view.fingerprint),
        waveform_luma: waveform,
        waveform_resolution: SCOPE_RESOLUTION as u16,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::hdr_display_capability::{EdrHeadroomSample, compile_hdr_display_capability};
    use crate::color::hdr_editing::{
        EditingDynamicRangeMode, HdrEditingSettingsV1, SdrRenditionSettingsV1,
    };

    fn plan(surface_accepted: bool) -> HdrEditingPlanV1 {
        let capability = compile_hdr_display_capability(
            "test-display-profile".to_string(),
            EdrHeadroomSample {
                current: Some(4.0),
                potential: Some(8.0),
                reference: Some(1.0),
            },
            surface_accepted,
        );
        HdrEditingPlanV1::compile(
            HdrEditingSettingsV1 {
                hdr_limit_stops: 3.0,
                mode: EditingDynamicRangeMode::Hdr,
                sdr_rendition: SdrRenditionSettingsV1::default(),
            },
            &capability,
            12,
            0xfeed,
        )
        .unwrap()
    }

    #[test]
    fn scopes_keep_hdr_display_and_sdr_domains_distinct_and_current() {
        let scene = [[0.18; 3], [1.0; 3], [4.0; 3], [64.0; 3]];
        let plan = plan(true);
        let hdr =
            analyze_hdr_scopes(&plan, &scene, 4, 1, HdrScopeRenditionV1::SceneHdrView).unwrap();
        let display = analyze_hdr_scopes(
            &plan,
            &scene,
            4,
            1,
            HdrScopeRenditionV1::DisplayPresentation,
        )
        .unwrap();
        let sdr =
            analyze_hdr_scopes(&plan, &scene, 4, 1, HdrScopeRenditionV1::SdrRendition).unwrap();

        assert_eq!(hdr.scope_axis.target_peak_linear, 8.0);
        assert_eq!(display.scope_axis.target_peak_linear, 4.0);
        assert_eq!(sdr.scope_axis.target_peak_linear, 1.0);
        assert!(hdr.stats.hdr_pixels > 0);
        assert!(display.stats.hdr_pixels > 0);
        assert_eq!(sdr.stats.hdr_pixels, 0);
        assert_eq!(hdr.stats.total_pixels, 4);
        assert_eq!(hdr.histogram_luma.iter().sum::<u32>(), 4);
        assert_eq!(hdr.waveform_luma.iter().sum::<u32>(), 4);
        assert_eq!(hdr.capability_generation, 12);
        assert_eq!(hdr.scene_edit_fingerprint, "000000000000feed");
        assert_ne!(hdr.view_fingerprint, sdr.view_fingerprint);
    }

    #[test]
    fn fallback_receipt_is_sdr_but_does_not_erase_hdr_scope_headroom() {
        let scene = [[4.0; 3], [f32::NAN, 0.0, 0.0]];
        let plan = plan(false);
        let hdr =
            analyze_hdr_scopes(&plan, &scene, 2, 1, HdrScopeRenditionV1::SceneHdrView).unwrap();
        let display = analyze_hdr_scopes(
            &plan,
            &scene,
            2,
            1,
            HdrScopeRenditionV1::DisplayPresentation,
        )
        .unwrap();
        assert_eq!(hdr.scope_axis.target_peak_linear, 8.0);
        assert_eq!(display.scope_axis.target_peak_linear, 1.0);
        assert!(hdr.stats.hdr_pixels > 0);
        assert_eq!(display.stats.hdr_pixels, 0);
        assert_eq!(hdr.stats.non_finite_source_pixels, 1);
        assert_eq!(hdr.stats.over_peak_pixels, 0);
    }

    #[test]
    fn malformed_dimensions_fail_before_scope_output() {
        assert_eq!(
            analyze_hdr_scopes(
                &plan(true),
                &[[0.18; 3]],
                2,
                1,
                HdrScopeRenditionV1::SceneHdrView,
            ),
            Err("hdr_scopes_pixel_count_mismatch".to_string())
        );
    }
}
