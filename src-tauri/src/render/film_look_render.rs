use std::borrow::Cow;

use serde_json::{Map, Number, Value};

#[derive(Clone, Copy)]
struct FilmLookPatch {
    id: &'static str,
    patch: &'static [(&'static str, i32)],
}

const CONTROLLED_FIELDS: &[(&str, i32)] = &[
    ("temperature", 0),
    ("contrast", 0),
    ("highlights", 0),
    ("shadows", 0),
    ("blacks", 0),
    ("saturation", 0),
    ("glowAmount", 0),
    ("grainAmount", 0),
    ("grainRoughness", 50),
    ("grainSize", 25),
    ("halationAmount", 0),
];

const FILM_LOOK_PATCHES: &[FilmLookPatch] = &[
    FilmLookPatch {
        id: "film_look.generic.clean_color.v1",
        patch: &[("contrast", 12), ("saturation", 4)],
    },
    FilmLookPatch {
        id: "film_look.generic.warm_print.v1",
        patch: &[
            ("blacks", -4),
            ("contrast", 10),
            ("grainAmount", 10),
            ("grainRoughness", 58),
            ("grainSize", 32),
            ("halationAmount", 8),
            ("highlights", -12),
            ("saturation", 4),
            ("shadows", 4),
            ("temperature", 8),
        ],
    },
    FilmLookPatch {
        id: "film_look.generic.cool_contrast.v1",
        patch: &[
            ("contrast", 18),
            ("saturation", -2),
            ("shadows", -10),
            ("temperature", -8),
        ],
    },
    FilmLookPatch {
        id: "film_look.generic.soft_fade.v1",
        patch: &[("blacks", 8), ("contrast", -10), ("saturation", -18)],
    },
    FilmLookPatch {
        id: "film_look.generic.mono_silver.v1",
        patch: &[
            ("contrast", 12),
            ("grainAmount", 22),
            ("grainRoughness", 64),
            ("grainSize", 42),
            ("saturation", -100),
        ],
    },
    FilmLookPatch {
        id: "film_look.generic.punch_color.v1",
        patch: &[
            ("blacks", -3),
            ("contrast", 24),
            ("glowAmount", 8),
            ("halationAmount", 18),
        ],
    },
    FilmLookPatch {
        id: "film_look.generic.soft_portrait_color.v1",
        patch: &[
            ("contrast", 8),
            ("highlights", -8),
            ("saturation", 6),
            ("temperature", 4),
        ],
    },
    FilmLookPatch {
        id: "film_look.generic.sunlit_warmth.v1",
        patch: &[
            ("blacks", 4),
            ("contrast", -4),
            ("highlights", -6),
            ("saturation", 10),
            ("temperature", 9),
        ],
    },
    FilmLookPatch {
        id: "film_look.generic.deep_chroma.v1",
        patch: &[
            ("blacks", -6),
            ("contrast", 26),
            ("highlights", -4),
            ("saturation", 28),
        ],
    },
    FilmLookPatch {
        id: "film_look.generic.bold_mono_grain.v1",
        patch: &[
            ("blacks", -8),
            ("contrast", 30),
            ("grainAmount", 32),
            ("grainRoughness", 68),
            ("grainSize", 48),
            ("saturation", -100),
        ],
    },
];

pub(crate) fn normalize_film_look_adjustments_for_render(adjustments: &Value) -> Cow<'_, Value> {
    let Some(look_id) = adjustments.get("filmLookId").and_then(Value::as_str) else {
        return Cow::Borrowed(adjustments);
    };
    let Some(look) = FILM_LOOK_PATCHES
        .iter()
        .find(|candidate| candidate.id == look_id)
    else {
        return Cow::Borrowed(adjustments);
    };
    let Some(source) = adjustments.as_object() else {
        return Cow::Borrowed(adjustments);
    };

    let mut normalized = source.clone();
    let strength = clamp_strength(
        adjustments
            .get("filmLookStrength")
            .and_then(Value::as_f64)
            .unwrap_or(100.0),
    );

    for (field, default_value) in CONTROLLED_FIELDS {
        set_number(&mut normalized, field, *default_value);
    }

    for (field, value) in look.patch {
        set_number(
            &mut normalized,
            field,
            scale_film_look_value(field, *value, strength),
        );
    }

    set_number(
        &mut normalized,
        "filmLookStrength",
        (strength * 100.0).round() as i32,
    );
    Cow::Owned(Value::Object(normalized))
}

fn clamp_strength(value: f64) -> f32 {
    ((value.round() as i32).clamp(0, 100) as f32) / 100.0
}

fn set_number(target: &mut Map<String, Value>, key: &str, value: i32) {
    target.insert(key.to_string(), Value::Number(Number::from(value)));
}

fn scale_film_look_value(field: &str, value: i32, strength: f32) -> i32 {
    let default_value = match field {
        "grainRoughness" => 50,
        "grainSize" => 25,
        _ => 0,
    } as f32;

    (default_value + ((value as f32) - default_value) * strength).round() as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_or_unknown_look_borrows_adjustments() {
        let missing = json!({ "contrast": 3 });
        assert!(matches!(
            normalize_film_look_adjustments_for_render(&missing),
            Cow::Borrowed(_)
        ));

        let unknown =
            json!({ "filmLookId": "film_look.generic.unknown.v1", "filmLookStrength": 75 });
        assert!(matches!(
            normalize_film_look_adjustments_for_render(&unknown),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn clamps_strength_and_applies_generic_patch() {
        let adjustments = json!({
            "filmLookId": "film_look.generic.warm_print.v1",
            "filmLookStrength": 250,
            "contrast": 99,
            "temperature": 99
        });
        let normalized = normalize_film_look_adjustments_for_render(&adjustments).into_owned();

        assert_eq!(normalized["filmLookStrength"], 100);
        assert_eq!(normalized["contrast"], 10);
        assert_eq!(normalized["highlights"], -12);
        assert_eq!(normalized["temperature"], 8);
        assert_eq!(normalized["grainRoughness"], 58);
        assert_eq!(normalized["grainSize"], 32);
        assert_eq!(normalized["grainAmount"], 10);
    }

    #[test]
    fn resets_look_controlled_fields_before_applying_patch() {
        let adjustments = json!({
            "filmLookId": "film_look.generic.clean_color.v1",
            "filmLookStrength": 50,
            "grainAmount": 80,
            "grainRoughness": 5,
            "grainSize": 90,
            "glowAmount": 20,
            "halationAmount": 99
        });
        let normalized = normalize_film_look_adjustments_for_render(&adjustments).into_owned();

        assert_eq!(normalized["contrast"], 6);
        assert_eq!(normalized["saturation"], 2);
        assert_eq!(normalized["grainAmount"], 0);
        assert_eq!(normalized["grainRoughness"], 50);
        assert_eq!(normalized["grainSize"], 25);
        assert_eq!(normalized["glowAmount"], 0);
        assert_eq!(normalized["halationAmount"], 0);
    }

    #[test]
    fn preview_and_export_use_identical_normalized_payloads() {
        let adjustments = json!({
            "filmLookId": "film_look.generic.bold_mono_grain.v1",
            "filmLookStrength": 72
        });

        let preview = normalize_film_look_adjustments_for_render(&adjustments).into_owned();
        let export = normalize_film_look_adjustments_for_render(&adjustments).into_owned();

        assert_eq!(preview, export);
        assert_eq!(preview["saturation"], -72);
        assert_eq!(preview["grainAmount"], 23);
        assert_eq!(preview["grainRoughness"], 63);
        assert_eq!(preview["grainSize"], 42);
    }

    #[test]
    fn warm_print_default_aware_scaling_matches_browser_targets() {
        let twenty_five = normalize_film_look_adjustments_for_render(&json!({
            "filmLookId": "film_look.generic.warm_print.v1",
            "filmLookStrength": 25
        }))
        .into_owned();
        let sixty_five = normalize_film_look_adjustments_for_render(&json!({
            "filmLookId": "film_look.generic.warm_print.v1",
            "filmLookStrength": 65
        }))
        .into_owned();
        let full = normalize_film_look_adjustments_for_render(&json!({
            "filmLookId": "film_look.generic.warm_print.v1",
            "filmLookStrength": 100
        }))
        .into_owned();

        assert_eq!(twenty_five["contrast"], 3);
        assert_eq!(twenty_five["highlights"], -3);
        assert_eq!(twenty_five["shadows"], 1);
        assert_eq!(twenty_five["blacks"], -1);
        assert_eq!(twenty_five["saturation"], 1);
        assert_eq!(twenty_five["grainAmount"], 3);
        assert_eq!(twenty_five["grainRoughness"], 52);
        assert_eq!(twenty_five["grainSize"], 27);
        assert_eq!(twenty_five["halationAmount"], 2);

        assert_eq!(sixty_five["contrast"], 7);
        assert_eq!(sixty_five["highlights"], -8);
        assert_eq!(sixty_five["shadows"], 3);
        assert_eq!(sixty_five["blacks"], -3);
        assert_eq!(sixty_five["saturation"], 3);
        assert_eq!(sixty_five["grainAmount"], 7);
        assert_eq!(sixty_five["grainRoughness"], 55);
        assert_eq!(sixty_five["grainSize"], 30);
        assert_eq!(sixty_five["halationAmount"], 5);

        assert_eq!(full["contrast"], 10);
        assert_eq!(full["highlights"], -12);
        assert_eq!(full["shadows"], 4);
        assert_eq!(full["blacks"], -4);
        assert_eq!(full["saturation"], 4);
        assert_eq!(full["grainAmount"], 10);
        assert_eq!(full["grainRoughness"], 58);
        assert_eq!(full["grainSize"], 32);
        assert_eq!(full["halationAmount"], 8);
    }

    #[test]
    fn includes_runtime_halation_and_grain_roughness_controls() {
        let halation = normalize_film_look_adjustments_for_render(&json!({
            "filmLookId": "film_look.generic.punch_color.v1",
            "filmLookStrength": 50
        }))
        .into_owned();
        let grain = normalize_film_look_adjustments_for_render(&json!({
            "filmLookId": "film_look.generic.mono_silver.v1",
            "filmLookStrength": 50
        }))
        .into_owned();

        assert_eq!(halation["halationAmount"], 9);
        assert_eq!(grain["grainRoughness"], 57);
    }
}
