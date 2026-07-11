use super::support::{SampleEstimate, SupportClass};

#[derive(Clone, Copy, Debug, Default)]
pub struct FusedColorSample {
    pub fallback: bool,
    pub rgb: [f32; 3],
}

pub fn reconstruct_color(
    red: SampleEstimate,
    green_one: SampleEstimate,
    green_two: SampleEstimate,
    blue: SampleEstimate,
    baseline: [f32; 3],
    white_balance: [f32; 4],
) -> FusedColorSample {
    let supported = [red, green_one, green_two, blue]
        .into_iter()
        .all(|sample| sample.support_class() == SupportClass::Supported);
    if !supported {
        return FusedColorSample {
            fallback: true,
            rgb: baseline,
        };
    }
    let green_weight = green_one.weight_sum + green_two.weight_sum;
    let green = if green_weight > 0.0 {
        (green_one.estimate * green_one.weight_sum + green_two.estimate * green_two.weight_sum)
            / green_weight
    } else {
        0.0
    };
    FusedColorSample {
        fallback: false,
        rgb: [
            red.estimate * white_balance[0],
            green * (white_balance[1] + white_balance[2]) * 0.5,
            blue.estimate * white_balance[3],
        ],
    }
}
