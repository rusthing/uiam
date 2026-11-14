//! # 网关发布控制器
//!
//! `GET /uiam/gateway/render-preview/{id}`：返回渲染出的完整 TOML、摘要、
//! 各类计数、结构变更说明与告警。**只渲染不落库、不推 KV**。
//!
//! 与 CRUD 路由分开的原因：`#[router(crud)]` 与 `#[router(routes ...)]` 各自
//! 生成一棵路由树、各自按 ctrl 名推导前缀，混在一起没法给「发布」这类动作
//! 单独定路径。

use crate::svc::render_preview;
use axum::debug_handler;
use axum::extract::Path;
use axum::response::Json;
use robotech::api::Ro;
use robotech::macros::log_call;
use robotech::web::CtrlError;
use uiam_api::vo::UiamGatewayRenderPreviewVo;

/// # 渲染预览
///
/// ## 路径参数
/// * `id` - 网关实例 ID
///
/// ## 返回值
/// * `Ro<UiamGatewayRenderPreviewVo>` - TOML 全文、摘要、计数、结构变更说明、告警
/// * 实例不存在返回 404
#[utoipa::path(
    get,
    path = "/uiam/gateway/render-preview/{id}",
    params(("id" = u64, Path, description = "网关实例 ID")),
    responses((status = OK, body = Ro<UiamGatewayRenderPreviewVo>))
)]
#[debug_handler]
#[log_call]
pub async fn render_preview_handler(
    Path(id): Path<u64>,
) -> Result<Json<Ro<UiamGatewayRenderPreviewVo>>, CtrlError> {
    let data = render_preview(id).await?;
    Ok(Json(Ro::success("渲染完成".to_string()).extra(Some(data))))
}
