//! # 网关发布（渲染 / 发布 / 回滚）
//!
//! 这里的函数**不是** `#[svc]` 生成的 CRUD，而是跨表的编排：要读整棵子树、
//! 要拿上一版发布记录做比对、后面还要写 Consul KV。放在单独文件里是为了让
//! 「通用增删改查」和「一次发布动作」在代码上就是两件事。
//!
//! ## 当前进度
//!
//! 一期这一步只落地了**渲染**：
//!
//! | 能力 | 状态 |
//! |---|---|
//! | [`render_preview`] 渲染 + 自检 + 试装配 + 结构比对 | 已完成 |
//! | `publish` 落库（`pushed=false`）→ PUT KV → 回填 | 待做 |
//! | `rollback` 取历史 `content` 原样重推 | 待做 |
//!
//! 预览和发布用的是**同一个** [`crate::render::render`]，所以预览看到的 TOML
//! 与发布写进 `release.content` 的逐字节相同。不存在「预览通过了、发布却不一样」。

use crate::mo::uiam_gateway::Entity as GatewayEntity;
use crate::mo::uiam_gateway_balancer::Entity as BalancerEntity;
use crate::mo::uiam_gateway_listener::Entity as ListenerEntity;
use crate::mo::uiam_gateway_release::Entity as ReleaseEntity;
use crate::mo::uiam_gateway_route::Entity as RouteEntity;
use crate::render::{PreviousRelease, RenderInput, RenderedConfig, render};
use robotech::api::U64;
use robotech::dao::DaoError;
use robotech::db::get_db_conn;
use robotech::svc::SvcError;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
};
use uiam_api::vo::{
    UiamGatewayBalancerVo, UiamGatewayListenerVo, UiamGatewayRenderPreviewVo, UiamGatewayRouteVo,
    UiamGatewayVo,
};

/// # 渲染预览
///
/// 读整棵子树 → 渲染 → 自检 → 试装配 → 与上一版发布记录做结构比对。
/// **不写库、不推 KV**，可反复调用。
///
/// ## 参数
/// - `id`：网关实例 id
///
/// ## 返回值
/// [`UiamGatewayRenderPreviewVo`]：TOML 全文、摘要、各类计数、结构变更说明、告警
///
/// ## 错误
/// - 实例不存在：`SvcError`
/// - 渲染失败：库里的 JSON 列坏了 / `extra_toml` 语法错 / 配置装不起来，
///   错误信息已经是给用户看的那句话
pub async fn render_preview(id: u64) -> Result<UiamGatewayRenderPreviewVo, SvcError> {
    let db = get_db_conn()?;
    render_preview_with_db(db.as_ref(), id).await
}

/// # 渲染预览（指定连接）
///
/// 与 [`render_preview`] 相同，只是把连接显式传进来，便于测试注入事务。
///
/// ## 参数
/// - `db`：数据库连接
/// - `id`：网关实例 id
///
/// ## 返回值
/// 同 [`render_preview`]
pub async fn render_preview_with_db<C>(
    db: &C,
    id: u64,
) -> Result<UiamGatewayRenderPreviewVo, SvcError>
where
    C: ConnectionTrait + Sync,
{
    let input = load_render_input(db, id).await?;
    let previous = load_previous_release(db, id).await?;

    let rendered = render(&input, previous.as_ref()).map_err(render_err)?;

    Ok(to_preview(id, rendered))
}

/// # 读一个实例的整棵子树
///
/// ## 参数
/// - `db`：数据库连接
/// - `gateway_id`：网关实例 id
///
/// ## 返回值
/// [`RenderInput`]：实例 + 监听器 + 路由 + 负载均衡器
///
/// ## 错误
/// 实例不存在时返回 `SvcError`；监听器/路由/负载均衡器查询失败时返回库错误
///
/// ## 说明
/// 路由**按实例一次性读全**（`listener_id IN (...)`），不做 N+1：一个实例通常
/// 几个监听器、几十条路由，逐监听器查库会让预览接口的耗时随监听器数量线性增长。
pub async fn load_render_input<C>(db: &C, gateway_id: u64) -> Result<RenderInput, SvcError>
where
    C: ConnectionTrait + Sync,
{
    let gateway_id_i64 = to_i64(gateway_id)?;

    let gateway = GatewayEntity::find_by_id(gateway_id_i64)
        .one(db)
        .await
        .map_err(db_err)?
        .ok_or_else(|| SvcError::NotFound(format!("网关实例#{gateway_id}不存在")))?;

    let listeners = ListenerEntity::find()
        .filter(crate::mo::uiam_gateway_listener::Column::GatewayId.eq(gateway_id_i64))
        .order_by_asc(crate::mo::uiam_gateway_listener::Column::SortNo)
        .order_by_asc(crate::mo::uiam_gateway_listener::Column::Id)
        .all(db)
        .await
        .map_err(db_err)?;

    let listener_ids: Vec<i64> = listeners.iter().map(|l| l.id).collect();
    let routes = if listener_ids.is_empty() {
        // 没有监听器时不要发 `IN ()` —— 某些后端会直接语法错误
        Vec::new()
    } else {
        RouteEntity::find()
            .filter(crate::mo::uiam_gateway_route::Column::ListenerId.is_in(listener_ids))
            .order_by_asc(crate::mo::uiam_gateway_route::Column::SortNo)
            .order_by_asc(crate::mo::uiam_gateway_route::Column::Id)
            .all(db)
            .await
            .map_err(db_err)?
    };

    let balancers = BalancerEntity::find()
        .filter(crate::mo::uiam_gateway_balancer::Column::GatewayId.eq(gateway_id_i64))
        .order_by_asc(crate::mo::uiam_gateway_balancer::Column::Name)
        .all(db)
        .await
        .map_err(db_err)?;

    Ok(RenderInput {
        gateway: UiamGatewayVo::from(gateway),
        listeners: listeners.into_iter().map(UiamGatewayListenerVo::from).collect(),
        routes: routes.into_iter().map(UiamGatewayRouteVo::from).collect(),
        balancers: balancers
            .into_iter()
            .map(UiamGatewayBalancerVo::from)
            .collect(),
    })
}

/// # 取该实例的上一版发布记录
///
/// ## 参数
/// - `db`：数据库连接
/// - `gateway_id`：网关实例 id
///
/// ## 返回值
/// 最新一版发布记录；从没发布过时返回 `None`（此时不做结构比对——
/// 首版必然要重启，调用方按「首次发布」处理即可）
pub async fn load_previous_release<C>(
    db: &C,
    gateway_id: u64,
) -> Result<Option<PreviousRelease>, SvcError>
where
    C: ConnectionTrait + Sync,
{
    let gateway_id_i64 = to_i64(gateway_id)?;

    let latest = ReleaseEntity::find()
        .filter(crate::mo::uiam_gateway_release::Column::GatewayId.eq(gateway_id_i64))
        .order_by_desc(crate::mo::uiam_gateway_release::Column::Version)
        .limit(1)
        .one(db)
        .await
        .map_err(db_err)?;

    Ok(latest.map(|release| PreviousRelease {
        id: release.id as u64,
        content: release.content,
    }))
}

/// 把渲染结果拍成 VO
fn to_preview(id: u64, rendered: RenderedConfig) -> UiamGatewayRenderPreviewVo {
    UiamGatewayRenderPreviewVo {
        gateway_id: U64(id),
        toml: rendered.toml,
        checksum: rendered.checksum,
        http_listeners: rendered.report.http_listeners as u32,
        tcp_listeners: rendered.report.tcp_listeners as u32,
        routes: rendered.report.routes as u32,
        tcp_routes: rendered.report.tcp_routes as u32,
        balancers: rendered.report.balancers as u32,
        structural_change: rendered.structural_change,
        warnings: rendered.warnings,
    }
}

/// # 渲染错误转成 `SvcError`
///
/// `RenderError` 的 `Display` 已经是给用户看的那句话（「listeners[0].addrs 变化：
/// 监听地址在启动时绑定…」），直接透传，不再包一层「渲染失败：」——
/// 用户要的是原因，不是分类。
///
/// ## 为什么走 `Validation` 而不是 `Runtime`
///
/// 渲染失败几乎都是**用户写错了配置**（正则非法、引用了不存在的负载均衡器、
/// 高级配置语法错），不是服务端故障。`SvcError::Runtime` 会被映射成 500 且
/// `msg` 固定为「运行时错误」，原因只能去 `detail` 里翻；`Validation` 是 400、
/// `msg` 就是那句话本身，前端可以直接弹出来。
fn render_err(err: crate::render::RenderError) -> SvcError {
    SvcError::Validation(
        validator::ValidationError::new("render")
            .with_message(std::borrow::Cow::Owned(err.to_string())),
    )
}

/// # `u64` 转 `i64`
///
/// 雪花 ID 不会超出 `i64`，但数据库列是 `INT8`，越界时给一句人话而不是让
/// `as` 静默截断。
fn to_i64(id: u64) -> Result<i64, SvcError> {
    i64::try_from(id)
        .map_err(|_| SvcError::Validation(
            validator::ValidationError::new("id")
                .with_message(std::borrow::Cow::Borrowed("ID 超出范围")),
        ))
}

/// 库错误转成 `SvcError`
fn db_err(err: sea_orm::DbErr) -> SvcError {
    SvcError::from(DaoError::parse_db_err(err))
}
