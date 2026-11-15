//! # 网关配置导入控制器
//!
//! | 方法 | 路径 | 作用 |
//! |---|---|---|
//! | `GET` | `/uiam/gateway/import/source/{id}` | 读出网关正在读的那份 TOML |
//! | `POST` | `/uiam/gateway/import/{id}` | 把一份现成 TOML 拆成结构化数据写进库 |
//!
//! ## 为什么和发布放在同一棵 `/uiam/gateway` 下
//!
//! 导入、预览、发布、回滚是同一条链路上的四步：先导入（让库里等于线上）、
//! 再预览（确认渲染结果）、再发布（写 KV）、出问题回滚。路径挨着，用户
//! 在 Swagger 里也是连着看。
//!
//! ## 必须带 `X-User-Id`
//!
//! 导入会**整段替换**该实例的监听器/路由/负载均衡器，是一次真正的写操作。
//! 操作者要记进新插入记录的 `creater_id`——一期不建审计表，这是唯一的线索。
//! 读取原文不写库，所以不要求这个头。

use crate::svc::{ImportOptions, fetch_source, import_gateway};
use axum::debug_handler;
use axum::extract::{Path, Query};
use axum::http::HeaderMap;
use axum::response::Json;
use robotech::api::Ro;
use robotech::macros::log_call;
use robotech::web::ctrl_utils::get_current_user_id;
use robotech::web::CtrlError;
use uiam_api::dto::{UiamGatewayImportDto, UiamGatewayImportSourceQuery};
use uiam_api::vo::{UiamGatewayImportSourceVo, UiamGatewayImportVo};

/// # 读取网关正在读的 TOML
///
/// 从 Consul KV 里把该实例的配置原文拉出来。导入弹窗用它做「一键取线上配置」，
/// 免得接管时还得 ssh 上去 `curl` 一遍——那一步既容易抄错，也没法留痕。
///
/// ## 路径参数
/// * `id` - 网关实例 ID
///
/// ## 查询参数
/// * `consulKey` - 临时指定要读的 key；不传则用实例自己的 `consulKey`
///
/// ## 返回值
/// * `Ro<UiamGatewayImportSourceVo>` - TOML 原文、完整 key、`ModifyIndex`
/// * key 不存在不算错：`found = false` 且 `note` 里说明原因
/// * Consul 读失败：500，`msg` 里带完整 key 与原因
#[utoipa::path(
    get,
    path = "/uiam/gateway/import/source/{id}",
    params(
        ("id" = u64, Path, description = "网关实例 ID"),
        ("consulKey" = Option<String>, Query, description = "临时指定要读的 KV key")
    ),
    responses((status = OK, body = Ro<UiamGatewayImportSourceVo>))
)]
#[debug_handler]
#[log_call]
pub async fn source_handler(
    Path(id): Path<u64>,
    Query(query): Query<UiamGatewayImportSourceQuery>,
) -> Result<Json<Ro<UiamGatewayImportSourceVo>>, CtrlError> {
    let data = fetch_source(id, query.consul_key).await?;

    let message = if data.found {
        format!(
            "已读取 [{}]：{} 字节（ModifyIndex {}）",
            data.full_key,
            data.content.len(),
            data.modify_index.unwrap_or_default()
        )
    } else {
        format!("[{}] 里没有内容", data.full_key)
    };

    Ok(Json(Ro::success(message).extra(Some(data))))
}

/// # 导入现有 TOML
///
/// 把一份已经在跑的网关配置（通常是 Consul KV 里那一份）拆成监听器、路由、
/// 负载均衡器和实例级 JSON 列，**整段替换**该实例现有的结构化数据。
///
/// ## 路径参数
/// * `id` - 网关实例 ID
///
/// ## 请求体
/// * `UiamGatewayImportDto` - `toml`（必填）、`consulKey`（顺带改 key）、
///   `dryRun`（只校验不落库，默认 `false`）
///
/// ## 请求头
/// * `X-User-Id` - 操作者 ID，记进新插入记录的 `creater_id`，必需
///
/// ## 返回值
/// * `Ro<UiamGatewayImportVo>` - 各类计数、导入后渲染出的 TOML 与摘要、
///   与线上 KV 的语义比对结果（`kvMatches` / `kvDiff`）、告警
/// * TOML 读不懂 / 往返比对不一致 / 配置装不起来：400，`msg` 里是原因
/// * 实例不存在：404
///
/// ## 关于 `kvMatches`
///
/// 导入完成后会从库里重新渲染一遍，再跟 `consulKey` 指向的线上内容做语义比对。
/// `true` 表示「库里现在这份与线上正在跑的一致」——这时候发布不会改变网关行为，
/// 接管是安全的；`false` 就要看 `kvDiff` 逐条确认，因为发布就是改线上配置。
#[utoipa::path(
    post,
    path = "/uiam/gateway/import/{id}",
    params(("id" = u64, Path, description = "网关实例 ID")),
    request_body = UiamGatewayImportDto,
    responses((status = OK, body = Ro<UiamGatewayImportVo>))
)]
#[debug_handler]
#[log_call]
pub async fn import_handler(
    headers: HeaderMap,
    Path(id): Path<u64>,
    Json(dto): Json<UiamGatewayImportDto>,
) -> Result<Json<Ro<UiamGatewayImportVo>>, CtrlError> {
    let operator_id = get_current_user_id(&headers)?.0;
    let options = ImportOptions {
        operator_id,
        dry_run: dto.dry_run,
        consul_key: dto.consul_key,
    };

    let data = import_gateway(id, &dto.toml, options).await?;

    let message = if data.dry_run {
        format!(
            "预演完成：{} 个监听器、{} 条路由、{} 个负载均衡器（未写库）",
            data.http_listeners + data.tcp_listeners,
            data.http_routes + data.tcp_routes,
            data.balancers
        )
    } else {
        format!(
            "已导入：{} 个监听器、{} 条路由、{} 个负载均衡器",
            data.http_listeners + data.tcp_listeners,
            data.http_routes + data.tcp_routes,
            data.balancers
        )
    };

    Ok(Json(Ro::success(message).extra(Some(data))))
}
