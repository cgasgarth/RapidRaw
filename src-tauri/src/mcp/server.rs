use std::{future::Future, sync::Arc};

use rmcp::{
    ErrorData, RoleServer,
    handler::server::{
        ServerHandler,
        router::tool::ToolRoute,
        tool::{ToolCallContext, ToolRouter},
    },
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, Implementation, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
    },
    service::{MaybeSendFuture, RequestContext},
    transport::streamable_http_server::{
        StreamableHttpService, session::never::NeverSessionManager,
        tower::StreamableHttpServerConfig,
    },
};
use serde_json::{Value, json};
use tauri::AppHandle;

use super::{MAX_BODY_BYTES, tools};

pub(crate) type McpHttpService = StreamableHttpService<McpServer, NeverSessionManager>;

pub(crate) struct McpServer {
    app_handle: AppHandle,
    tool_router: ToolRouter<McpServer>,
}

pub(crate) fn create_http_service(app_handle: AppHandle) -> McpHttpService {
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_max_request_body_bytes(MAX_BODY_BYTES);

    StreamableHttpService::new(
        move || {
            Ok(build_router(McpServer {
                app_handle: app_handle.clone(),
                tool_router: ToolRouter::new(),
            }))
        },
        Arc::new(NeverSessionManager::default()),
        config,
    )
}

fn build_router(mut server: McpServer) -> McpServer {
    let routes = tools::tool_definitions()
        .into_iter()
        .map(tool_route)
        .collect::<Vec<_>>();
    for route in routes {
        server.tool_router.add_route(route);
    }
    server
}

fn tool_route(definition: Value) -> ToolRoute<McpServer> {
    let name = definition
        .get("name")
        .and_then(Value::as_str)
        .expect("MCP tool definition must have a name")
        .to_owned();
    let description = definition
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let input_schema = definition
        .get("inputSchema")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let tool = Tool::new(name, description, Arc::new(input_schema));

    ToolRoute::<McpServer>::new_dyn(tool, |context: ToolCallContext<'_, McpServer>| {
        let app_handle = context.service.app_handle.clone();
        let name = context.name.to_string();
        let arguments = Value::Object(context.arguments.unwrap_or_default());

        Box::pin(async move {
            let value = tools::call_tool(&app_handle, &name, arguments)
                .await
                .map_err(|(_, message)| ErrorData::invalid_params(message, None))?;
            let result = serde_json::from_value::<CallToolResult>(value).map_err(|error| {
                ErrorData::internal_error(
                    "RapidRAW returned an invalid MCP tool result",
                    Some(json!({ "reason": error.to_string() })),
                )
            })?;
            Ok(result.into())
        })
    })
}

impl ServerHandler for McpServer {
    fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<CallToolResponse, ErrorData>> + MaybeSendFuture + '_ {
        self.tool_router
            .call(ToolCallContext::new(self, request, context))
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, ErrorData>> + MaybeSendFuture + '_ {
        std::future::ready(Ok(ListToolsResult {
            tools: self.tool_router.list_all(),
            ..Default::default()
        }))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tool_router.get(name).cloned()
    }

    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("RapidRAW", env!("CARGO_PKG_VERSION")))
            .with_instructions(
                "Use imagePath explicitly on every RapidRAW operation. Mutations return an editRevision; pass it back as expectedRevision to avoid overwriting newer edits.",
            )
    }
}
