//! # 网关发布控制器
//!
//! 三个非 CRUD 的动作：
//!
//! | 方法 | 路径 | 作用 |
//! |---|---|---|
//! | `GET` | `/uiam/gateway/render-preview/{id}` | 只渲染，看结果 |
//! | `POST` | `/uiam/gateway/publish/{id}` | 渲染 + 落库 + 推 KV |
//! | `POST` | `/uiam/gateway/rollback/{id}` | 历史版本原样重推（`id` 是**发布记录** id） |
//!
//! 与 CRUD 路由分开的原因：`#[router(crud)]` 与 `#[router(routes ...)]` 各自
//! 生成一棵路由树、各自按 ctrl 名推导前缀，混在一起没法给「发布」这类动作
//! 单独定路径。
//!
//! ## 发布和回滚都必须带 `X-User-Id`
//!
//! 要记「谁发的」——这是审计的唯一线索（一期不建 `uiam_audit_log`，审计就落在
//! `release.creater_id` 上）。预览其实不需要用户身份，但三个接口放在同一棵
//! 路由树里，统一要求反而少一种「这个接口要不要带」的记忆负担。

use crate::svc::{PublishOptions, RollbackOptions, publish, render_preview, rollback};
use axum::debug_handler;
use axum::extract::Path;
use axum::http::HeaderMap;
use axum::response::Json;
use robotech::api::Ro;
use robotech::macros::log_call;
use robotech::web::ctrl_utils::get_current_user_id;
use robotech::web::CtrlError;
use uiam_api::dto::{UiamGatewayPublishDto, UiamGatewayRollbackDto};
use uiam_api::vo::{UiamGatewayPublishVo, UiamGatewayRenderPreviewVo};

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

/// # 发布
///
/// 把库里当前配置渲染成完整 TOML 并推到 Consul KV，产生一个新版本。
///
/// ## 路径参数
/// * `id` - 网关实例 ID
///
/// ## 请求体
/// * `UiamGatewayPublishDto` - `force`（内容没变也推）、`confirmRestart`（已确认重启）
///
/// ## 请求头
/// * `X-User-Id` - 操作者 ID，记进发布记录的 `creater_id`，必需
///
/// ## 返回值
/// * `Ro<UiamGatewayPublishVo>` - 新版本号、摘要、是否真的推了、`ModifyIndex`、告警
/// * 有结构性变更但没带 `confirmRestart` 返回 400，`msg` 说明为什么要重启
/// * Consul 写失败返回 500，`detail` 说明「记录已生成、状态未推送」
#[utoipa::path(
    post,
    path = "/uiam/gateway/publish/{id}",
    params(("id" = u64, Path, description = "网关实例 ID")),
    request_body = UiamGatewayPublishDto,
    responses((status = OK, body = Ro<UiamGatewayPublishVo>))
)]
#[debug_handler]
#[log_call]
pub async fn publish_handler(
    headers: HeaderMap,
    Path(id): Path<u64>,
    Json(dto): Json<UiamGatewayPublishDto>,
) -> Result<Json<Ro<UiamGatewayPublishVo>>, CtrlError> {
    let operator_id = get_current_user_id(&headers)?.0;
    let options = PublishOptions {
        operator_id,
        force: dto.force,
        confirm_restart: dto.confirm_restart,
    };

    let data = publish(id, options).await?;
    let message = if data.skipped {
        format!("内容与线上版本一致（v{}），未重复推送", data.version)
    } else {
        format!("已发布 v{}", data.version)
    };
    Ok(Json(Ro::success(message).extra(Some(data))))
}

/// # 回滚
///
/// 把某条历史发布记录的 `content` **原样**再推一次，产生一条新版本记录。
/// 不重新渲染——重渲染得到的是「现在的配置」，不是「当初发出去的那一份」。
///
/// ## 路径参数
/// * `id` - **发布记录** ID（不是网关实例 ID）
///
/// ## 请求体
/// * `UiamGatewayRollbackDto` - `confirmRestart`（已确认重启）
///
/// ## 请求头
/// * `X-User-Id` - 操作者 ID，记进新版本记录的 `creater_id`，必需
///
/// ## 返回值
/// * `Ro<UiamGatewayPublishVo>` - 新版本号、摘要、`ModifyIndex`、告警
/// * 记录不存在返回 404
/// * 需要重启但没确认返回 400
#[utoipa::path(
    post,
    path = "/uiam/gateway/rollback/{id}",
    params(("id" = u64, Path, description = "发布记录 ID")),
    request_body = UiamGatewayRollbackDto,
    responses((status = OK, body = Ro<UiamGatewayPublishVo>))
)]
#[debug_handler]
#[log_call]
pub async fn rollback_handler(
    headers: HeaderMap,
    Path(id): Path<u64>,
    Json(dto): Json<UiamGatewayRollbackDto>,
) -> Result<Json<Ro<UiamGatewayPublishVo>>, CtrlError> {
    let operator_id = get_current_user_id(&headers)?.0;
    let options = RollbackOptions {
        operator_id,
        confirm_restart: dto.confirm_restart,
    };

    let data = rollback(id, options).await?;
    let message = if data.skipped {
        format!("该版本的内容已在线上（v{}），未重复推送", data.version)
    } else {
        format!("已回滚，生成新版本 v{}", data.version)
    };
    Ok(Json(Ro::success(message).extra(Some(data))))
}
