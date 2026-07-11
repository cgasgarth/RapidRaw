pub(crate) const POLICY_ID: &str = "focus_binomial_pyramid_v1";
pub(crate) const KERNEL: [f32; 5] = [0.0625, 0.25, 0.375, 0.25, 0.0625];

#[derive(Clone, Debug)]
pub(crate) struct Plane {
    pub width: usize,
    pub height: usize,
    pub values: Vec<f32>,
}

pub(crate) fn level_count(width: usize, height: usize) -> usize {
    ((width.min(height) as f32).log2().floor() as usize).clamp(5, 8)
}

pub(crate) fn gaussian(input: Plane, levels: usize) -> Vec<Plane> {
    let mut out = vec![input];
    while out.len() < levels && (out.last().unwrap().width > 1 || out.last().unwrap().height > 1) {
        out.push(downsample(out.last().unwrap()));
    }
    out
}

pub(crate) fn laplacian(input: Plane, levels: usize) -> Vec<Plane> {
    let gaussian = gaussian(input, levels);
    let mut out = Vec::with_capacity(gaussian.len());
    for level in 0..gaussian.len() - 1 {
        let expanded = upsample(
            &gaussian[level + 1],
            gaussian[level].width,
            gaussian[level].height,
        );
        out.push(Plane {
            width: gaussian[level].width,
            height: gaussian[level].height,
            values: gaussian[level]
                .values
                .iter()
                .zip(expanded.values)
                .map(|(a, b)| a - b)
                .collect(),
        });
    }
    out.push(gaussian.last().unwrap().clone());
    out
}

pub(crate) fn reconstruct(levels: &[Plane]) -> Plane {
    let mut current = levels.last().unwrap().clone();
    for level in levels[..levels.len() - 1].iter().rev() {
        let expanded = upsample(&current, level.width, level.height);
        current = Plane {
            width: level.width,
            height: level.height,
            values: level
                .values
                .iter()
                .zip(expanded.values)
                .map(|(a, b)| a + b)
                .collect(),
        };
    }
    current
}

fn downsample(input: &Plane) -> Plane {
    let filtered = blur(input);
    let width = input.width.div_ceil(2);
    let height = input.height.div_ceil(2);
    let mut values = Vec::with_capacity(width * height);
    for y in 0..height {
        for x in 0..width {
            values.push(
                filtered.values
                    [(y * 2).min(input.height - 1) * input.width + (x * 2).min(input.width - 1)],
            );
        }
    }
    Plane {
        width,
        height,
        values,
    }
}

pub(crate) fn upsample(input: &Plane, width: usize, height: usize) -> Plane {
    let values = (0..height)
        .flat_map(|y| {
            (0..width).map(move |x| {
                let sx = x as f32 * 0.5;
                let sy = y as f32 * 0.5;
                let x0 = sx.floor() as usize;
                let y0 = sy.floor() as usize;
                let x1 = (x0 + 1).min(input.width - 1);
                let y1 = (y0 + 1).min(input.height - 1);
                let tx = sx - x0 as f32;
                let ty = sy - y0 as f32;
                let a = input.values[y0 * input.width + x0] * (1.0 - tx)
                    + input.values[y0 * input.width + x1] * tx;
                let b = input.values[y1 * input.width + x0] * (1.0 - tx)
                    + input.values[y1 * input.width + x1] * tx;
                a * (1.0 - ty) + b * ty
            })
        })
        .collect();
    Plane {
        width,
        height,
        values,
    }
}

fn blur(input: &Plane) -> Plane {
    let mut horizontal = vec![0.0; input.values.len()];
    for y in 0..input.height {
        for x in 0..input.width {
            horizontal[y * input.width + x] = KERNEL
                .iter()
                .enumerate()
                .map(|(k, weight)| {
                    let sx =
                        (x as isize + k as isize - 2).clamp(0, input.width as isize - 1) as usize;
                    input.values[y * input.width + sx] * weight
                })
                .sum();
        }
    }
    let mut values = vec![0.0; input.values.len()];
    for y in 0..input.height {
        for x in 0..input.width {
            values[y * input.width + x] = KERNEL
                .iter()
                .enumerate()
                .map(|(k, weight)| {
                    let sy =
                        (y as isize + k as isize - 2).clamp(0, input.height as isize - 1) as usize;
                    horizontal[sy * input.width + x] * weight
                })
                .sum();
        }
    }
    Plane {
        width: input.width,
        height: input.height,
        values,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn focus_stack_blend_impulse_round_trip_is_exact() {
        let mut values = vec![0.0; 65 * 47];
        values[23 * 65 + 32] = 2.0;
        let reconstructed = reconstruct(&laplacian(
            Plane {
                width: 65,
                height: 47,
                values: values.clone(),
            },
            6,
        ));
        assert!(
            reconstructed
                .values
                .iter()
                .zip(values)
                .all(|(a, b)| (a - b).abs() < 1e-5)
        );
    }
    #[test]
    fn focus_stack_blend_checkerboard_has_stable_odd_dimensions() {
        let plane = Plane {
            width: 33,
            height: 25,
            values: (0..825).map(|i| (i % 2) as f32).collect(),
        };
        let levels = gaussian(plane, 5);
        assert_eq!(
            levels
                .iter()
                .map(|p| (p.width, p.height))
                .collect::<Vec<_>>(),
            vec![(33, 25), (17, 13), (9, 7), (5, 4), (3, 2)]
        );
    }
}
