//! # 用户偏好控制器
//!
//! | 方法 | 路径 | 作用 |
//! |---|---|---|
//! | `GET` | `/uiam/preferences` | 读取当前用户的整份偏好快照 |
//! | `PUT` | `/uiam/preferences` | 写入整份快照，`null` 表示删除该键 |
//!
//! 两个接口都必须带 `X-User-Id`：偏好按用户隔离，没有身份就不知道该读谁的数据。

use crate::svc::{load_prefs, save_prefs};
use axum::debug_handler;
use axum::http::HeaderMap;
use axum::response::Json;
use robotech::api::Ro;
use robotech::macros::log_call;
use robotech::web::ctrl_utils::get_current_user_id;
use robotech::web::CtrlError;
use uiam_api::dto::UiamPrefMap;

/// # 读取当前用户偏好
///
/// ## 请求头
/// * `X-User-Id` - 用户 ID，必需
///
/// ## 返回值
/// * `Ro<UiamPrefMap>` - `{ prefs: { "uiam-desktop": {...}, ... } }`；没有记录时 `prefs` 为空对象
#[utoipa::path(
    get,
    path = "/uiam/preferences",
    params(("X-User-Id" = String, Header, description = "用户 ID")),
    responses((status = OK, body = Ro<UiamPrefMap>))
)]
#[debug_handler]
#[log_call]
pub async fn get_prefs_handler(
    headers: HeaderMap,
) -> Result<Json<Ro<UiamPrefMap>>, CtrlError> {
    let user_id = get_current_user_id(&headers)?.0;
    let data = load_prefs(user_id).await?;
    Ok(Json(Ro::success("获取偏好成功".to_string()).extra(Some(data))))
}

/// # 保存当前用户偏好
///
/// 整份快照语义：请求里出现的键全部落库，值为 `null` 的键删除。
/// 只允许前端模块约定的四个键，其它键返回 400。
///
/// ## 请求头
/// * `X-User-Id` - 用户 ID，必需
///
/// ## 请求体
/// * `UiamPrefMap` - `{ prefs: { ... } }`
///
/// ## 返回值
/// * `Ro<UiamPrefMap>` - 保存后的完整快照
#[utoipa::path(
    put,
    path = "/uiam/preferences",
    params(("X-User-Id" = String, Header, description = "用户 ID")),
    request_body = UiamPrefMap,
    responses((status = OK, body = Ro<UiamPrefMap>))
)]
#[debug_handler]
#[log_call]
pub async fn save_prefs_handler(
    headers: HeaderMap,
    Json(map): Json<UiamPrefMap>,
) -> Result<Json<Ro<UiamPrefMap>>, CtrlError> {
    let user_id = get_current_user_id(&headers)?.0;
    let data = save_prefs(user_id, user_id, map).await?;
    Ok(Json(Ro::success("保存偏好成功".to_string()).extra(Some(data))))
}
