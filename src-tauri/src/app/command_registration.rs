use tauri::ipc::Invoke;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct CommandRegistration {
    pub(crate) domain: &'static str,
    pub(crate) path: &'static str,
}

macro_rules! define_command_registry {
    ([$($(#[$meta:meta])* ($domain:literal, $command:path)),* $(,)?]) => {
        pub(crate) fn invoke_handler() -> impl Fn(Invoke) -> bool + Send + Sync + 'static {
            debug_assert!(registry_is_unique());
            tauri::generate_handler![$($(#[$meta])* $command),*]
        }

        pub(crate) const fn registrations() -> &'static [CommandRegistration] {
            &[
                $($(#[$meta])* CommandRegistration {
                    domain: $domain,
                    path: stringify!($command),
                }),*
            ]
        }
    };
}

macro_rules! collect_editor_commands {
    ([$($entries:tt)*]) => {
        crate::editor::command_registration::with_commands!(collect_library_commands [$($entries)*]);
    };
}

macro_rules! collect_library_commands {
    ([$($entries:tt)*]) => {
        crate::library::command_registration::with_commands!(collect_export_commands [$($entries)*]);
    };
}

macro_rules! collect_export_commands {
    ([$($entries:tt)*]) => {
        crate::export::command_registration::with_commands!(collect_computational_commands [$($entries)*]);
    };
}

macro_rules! collect_computational_commands {
    ([$($entries:tt)*]) => {
        crate::computational::command_registration::with_commands!(collect_merge_commands [$($entries)*]);
    };
}

macro_rules! collect_merge_commands {
    ([$($entries:tt)*]) => {
        crate::merge::command_registration::with_commands!(define_command_registry [$($entries)*]);
    };
}

crate::app::commands::registration::with_commands!(collect_editor_commands []);

pub(crate) fn registered_command_names() -> Vec<&'static str> {
    registrations()
        .iter()
        .map(|registration| {
            registration
                .path
                .split(|character: char| !(character.is_ascii_alphanumeric() || character == '_'))
                .rfind(|segment| !segment.is_empty())
                .unwrap_or(registration.path)
        })
        .collect()
}

fn registry_is_unique() -> bool {
    let names = registered_command_names();
    names.len()
        == names
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>()
            .len()
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use super::*;

    #[test]
    fn domain_registrations_are_unique_and_cover_runtime_surfaces() {
        assert!(registry_is_unique());
        let domains = registrations()
            .iter()
            .fold(HashMap::new(), |mut counts, registration| {
                *counts.entry(registration.domain).or_insert(0usize) += 1;
                counts
            });
        for domain in ["startup", "editor", "library", "export", "computational"] {
            assert!(
                domains.get(domain).copied().unwrap_or_default() > 0,
                "missing {domain} commands"
            );
        }
    }

    #[test]
    fn feature_gated_commands_match_the_compiled_registry() {
        let names = registered_command_names()
            .into_iter()
            .collect::<HashSet<_>>();
        assert!(names.contains("check_ai_connector_status"));
        assert!(names.contains("generate_ai_subject_mask"));
        #[cfg(feature = "validation-harness")]
        {
            assert!(names.contains("run_color_gpu_readback_probe"));
            assert!(names.contains("run_raw_open_edit_export_proof"));
        }
        #[cfg(not(feature = "validation-harness"))]
        {
            assert!(!names.contains("run_color_gpu_readback_probe"));
            assert!(!names.contains("run_raw_open_edit_export_proof"));
        }
    }

    #[test]
    #[ignore = "executed by typed frontend/native command parity validation"]
    fn frontend_registry_matches_typed_invokes() {
        let frontend_names = serde_json::from_str::<Vec<String>>(
            &std::env::var("RAWENGINE_FRONTEND_INVOKES").expect("typed frontend invokes"),
        )
        .expect("valid typed frontend invoke JSON");
        let frontend = frontend_names.iter().cloned().collect::<HashSet<_>>();
        let native_names = registered_command_names();
        let native = native_names
            .iter()
            .map(|name| name.to_string())
            .collect::<HashSet<_>>();
        assert_eq!(
            native.len(),
            native_names.len(),
            "native commands must be unique"
        );
        assert_eq!(native, frontend);
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn composed_handler_invokes_representative_domain_commands() {
        use tauri::{ipc::InvokeBody, webview::InvokeRequest};

        let app = tauri::test::mock_builder()
            .manage(crate::app_state::AppState::new())
            .invoke_handler(tauri::generate_handler![
                crate::app::commands::startup::get_startup_trace,
                crate::image_open_session::get_image_open_diagnostics,
                crate::file_management::get_supported_file_types,
                crate::export::export_processing::get_export_color_capabilities,
                crate::computational::commands::cancellation::cancel_hdr_plan,
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("composed command application");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("command proof webview");
        let representatives = [
            ("startup", "get_startup_trace"),
            ("editor", "get_image_open_diagnostics"),
            ("library", "get_supported_file_types"),
            ("export", "get_export_color_capabilities"),
            ("computational", "cancel_hdr_plan"),
        ];

        for (index, (domain, command)) in representatives.into_iter().enumerate() {
            assert!(registrations().iter().any(|registration| {
                registration.domain == domain && registration.path.ends_with(command)
            }));
            let response = tauri::test::get_ipc_response(
                &webview,
                InvokeRequest {
                    cmd: command.into(),
                    callback: tauri::ipc::CallbackFn(index as u32 * 2),
                    error: tauri::ipc::CallbackFn(index as u32 * 2 + 1),
                    url: "tauri://localhost".parse().expect("proof URL"),
                    body: InvokeBody::default(),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            );
            assert!(
                response.is_ok(),
                "{domain} command {command} failed: {response:?}"
            );
        }
    }
}
