//! # 网关发布（渲染 / 发布 / 回滚）
//!
//! 这里的函数**不是** `#[svc]` 生成的 CRUD，而是跨表的编排：要读整棵子树、
//! 要拿上一版发布记录做比对、还要写 Consul KV。放在单独文件里是为了让
//! 「通用增删改查」和「一次发布动作」在代码上就是两件事。
//!
//! ## 三个能力
//!
//! | 能力 | 入口 | 是否写库 | 是否写 KV |
//! |---|---|---|---|
//! | [`render_preview`] 渲染预览 | `GET /uiam/gateway/render-preview/{id}` | 否 | 否 |
//! | [`publish`] 发布 | `POST /uiam/gateway/publish/{id}` | 是（新增版本） | 是 |
//! | [`rollback`] 回滚 | `POST /uiam/gateway/rollback/{id}` | 是（新增版本） | 是 |
//!
//! 预览和发布用的是**同一个** [`crate::render::render`]，所以预览看到的 TOML
//! 与发布写进 `release.content` 的逐字节相同。不存在「预览通过了、发布却不一样」。
//!
//! ## 一次发布的顺序（顺序本身就是设计）
//!
//! 1. 读整棵子树 → 渲染 → 自检 → 试装配 → 与上一版做结构比对
//! 2. 内容没变且已推送 → 直接返回「已跳过」，**不产生新版本**
//! 3. 有结构性变更但没确认 → 拒绝，让用户先看明白为什么要重启
//! 4. 分配版本号 → 落库（`pushed = false`）
//! 5. PUT Consul KV
//! 6. 回填 `pushed = true` / `pushed_ms`
//!
//! 第 4 步在第 5 步之前，是刻意的：**先落库再推送**，推失败了库里留下一条
//! 「未推送」的记录，能看见「这一版生成过、但没发出去」。反过来先推后落库，
//! 推成功而落库失败的话，KV 里有一份没有任何记录对应的配置——那才是真的失控。
//!
//! 第 6 步失败不会把整个发布判失败：KV 已经写成功了，配置就是生效了，
//! 这时候报错等于让用户以为没发出去、再点一次。所以降级为告警。
//!
//! ## 回滚为什么不重新渲染
//!
//! 渲染依赖的配置行（listener / route / balancer）在两次发布之间可能已经改过。
//! 重渲染得到的是「现在的配置」，不是「当初发出去的那一份」——那不叫回滚，
//! 叫重新发布。真正的回滚是把历史 `content` 原样 PUT 一次。
//!
//! 回滚**会**产生一条新版本（版本号继续递增，内容取自历史版本），而不是把
//! 指针拨回去：历史必须只增，「当前线上是哪一版」才永远等于「版本号最大的
//! 那一版」。否则回滚到 v2 之后 v3 还挂着，谁也不知道现在跑的是哪个。
//!
//! ### 回滚只改 KV，不改库里的配置行
//!
//! 这是最容易踩的一条：回滚把 v2 的内容推到线上，但 `listener` / `route` 表
//! 还是「改坏之后」的样子。所以**下一次发布会把库里现在的配置重新推上去**，
//! 等于撤销这次回滚。想让回滚成为永久状态，必须同时把配置行改回旧值
//! （或反过来，把「回滚」理解成「临时救火」）。
//!
//! 回滚结果里会带一条告警说明这件事，免得有人半夜回滚完、第二天随手发一次
//! 又炸回去。

use crate::dao::UiamGatewayReleaseDao;
use crate::kv::get_consul_kv;
use crate::mo::uiam_gateway::Entity as GatewayEntity;
use crate::mo::uiam_gateway_balancer::Entity as BalancerEntity;
use crate::mo::uiam_gateway_listener::Entity as ListenerEntity;
use crate::mo::uiam_gateway_release::ActiveModel as ReleaseActiveModel;
use crate::mo::uiam_gateway_release::Entity as ReleaseEntity;
use crate::mo::uiam_gateway_release::Model as ReleaseModel;
use crate::mo::uiam_gateway_route::Entity as RouteEntity;
use crate::render::{PreviousRelease, RenderInput, RenderedConfig, checksum, render};
use robotech::api::U64;
use robotech::dao::DaoError;
use robotech::db::get_db_conn;
use robotech::svc::SvcError;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
};
use std::borrow::Cow;
use tracing::{error, warn};
use uiam_api::vo::{
    UiamGatewayBalancerVo, UiamGatewayListenerVo, UiamGatewayPublishVo, UiamGatewayRenderPreviewVo,
    UiamGatewayRouteVo, UiamGatewayVo,
};

/// # 发布选项
///
/// 两个开关对应两个「不表态就不做」的动作：内容没变不重复推、要重启不静默发。
#[derive(Debug, Clone)]
pub struct PublishOptions {
    /// 操作者 ID（来自 `X-User-Id`），记进 `release.creater_id`
    pub operator_id: u64,
    /// 内容与线上版本一致时也强制推送
    pub force: bool,
    /// 已确认本次发布允许重启网关
    pub confirm_restart: bool,
}

/// # 回滚选项
#[derive(Debug, Clone)]
pub struct RollbackOptions {
    /// 操作者 ID，记进新版本记录的 `creater_id`
    pub operator_id: u64,
    /// 已确认本次回滚允许重启网关
    pub confirm_restart: bool,
}

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
/// - 实例不存在：`SvcError::NotFound`
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

/// # 发布
///
/// 渲染当前库里的配置并推到 Consul KV，产生一个新版本。
///
/// ## 参数
/// - `gateway_id`：网关实例 id
/// - `options`：操作者、是否强制推送、是否已确认重启
///
/// ## 返回值
/// [`UiamGatewayPublishVo`]：版本号、摘要、是否真的推了、`ModifyIndex`、
/// 结构变更说明、告警
///
/// ## 错误
/// - 实例不存在：404
/// - 配置装不起来 / 有结构变更但没确认 / 版本号被并发占用：400，`msg` 就是原因
/// - Consul 写失败：500，`detail` 里带「发布记录已生成」和失败原因
pub async fn publish(
    gateway_id: u64,
    options: PublishOptions,
) -> Result<UiamGatewayPublishVo, SvcError> {
    let db = get_db_conn()?;
    publish_with_db(db.as_ref(), gateway_id, options).await
}

/// # 发布（指定连接）
///
/// 与 [`publish`] 相同，连接由调用方给。
///
/// ## 参数
/// - `db`：数据库连接
/// - `gateway_id`：网关实例 id
/// - `options`：发布选项
///
/// ## 返回值
/// 同 [`publish`]
pub async fn publish_with_db<C>(
    db: &C,
    gateway_id: u64,
    options: PublishOptions,
) -> Result<UiamGatewayPublishVo, SvcError>
where
    C: ConnectionTrait + Sync,
{
    let input = load_render_input(db, gateway_id).await?;
    let latest = load_latest_release(db, gateway_id).await?;
    let previous = latest.as_ref().map(to_previous);
    let rendered = render(&input, previous.as_ref()).map_err(render_err)?;

    // 先看一眼 KV 里现在到底是什么。这次读取同时服务两件事：
    // 「要不要跳过」和「要不要提醒用户 KV 和库不一致」，所以只读一次。
    let kv_state = read_kv(&input.gateway.consul_key).await;
    let mut warnings = rendered.warnings.clone();

    // ---- 一、内容没变 + 上一版推过 + KV 里就是这一份：不产生新版本 ----
    if let Some(latest) = latest.as_ref() {
        let unchanged = latest.checksum == rendered.checksum && latest.pushed;
        // 只信数据库的 `pushed` 是不够的：KV 里的 key 可能被删了、Consul 可能
        // 换了一套、也可能有人手工改过。这时候「跳过」等于让线上继续跑旧内容，
        // 而管理面还以为自己已经发过了。所以必须确认 KV 里真是这一份。
        let kv_same = matches!(
            &kv_state,
            KvState::Present { content, .. } if checksum(content) == rendered.checksum
        );
        if unchanged && kv_same && !options.force {
            return Ok(UiamGatewayPublishVo {
                gateway_id: U64(gateway_id),
                release_id: U64(latest.id as u64),
                version: latest.version,
                checksum: rendered.checksum,
                pushed: false,
                skipped: true,
                consul_key: resolve_consul_key(&input.gateway.consul_key),
                modify_index: None,
                structural_change: rendered.structural_change,
                warnings,
            });
        }
    }

    // ---- 二、结构性变更必须显式确认 ----
    ensure_restart_confirmed(
        rendered.structural_change.as_deref(),
        options.confirm_restart,
    )?;

    // ---- 三、KV 现状与数据库不一致时说清楚（只告警，不拦）----
    if let Some(note) = drift_note(
        &kv_state,
        &resolve_consul_key(&input.gateway.consul_key),
        latest.as_ref(),
    ) {
        warnings.push(note);
    }

    // ---- 四到六、落库 → 推送 → 回填 ----
    let outcome = create_and_push(
        db,
        gateway_id,
        &input.gateway.consul_key,
        &rendered.toml,
        &rendered.checksum,
        options.operator_id,
        &mut warnings,
    )
    .await?;

    Ok(UiamGatewayPublishVo {
        gateway_id: U64(gateway_id),
        release_id: U64(outcome.release_id),
        version: outcome.version,
        checksum: rendered.checksum,
        pushed: true,
        skipped: false,
        consul_key: outcome.consul_key,
        modify_index: outcome.modify_index,
        structural_change: rendered.structural_change,
        warnings,
    })
}

/// # 回滚到指定版本
///
/// 把历史版本的 `content` 原样再推一次，**不重新渲染**，并产生一条新版本记录。
///
/// ## 参数
/// - `release_id`：要回到的那条发布记录 id
/// - `options`：操作者、是否已确认重启
///
/// ## 返回值
/// [`UiamGatewayPublishVo`]：新版本号、摘要、`ModifyIndex`、告警
///
/// ## 错误
/// - 发布记录不存在：404
/// - 该记录所属实例不存在：404
/// - 有结构变更但没确认：400
/// - Consul 写失败：500
///
/// ## 回滚不改库里的配置行
///
/// 只把历史 `content` 推回 KV。`listener` / `route` / `balancer` 表维持原样，
/// 所以下次发布会把库里现在的配置重新推上去——等于撤销这次回滚。
/// 结果里的 `warnings` 会说明这一点。
///
/// ## 为什么新版本号是「最大 +1」而不是「回到原来的号」
///
/// 历史必须只增。「当前线上是哪一版」这条信息，唯一的可信来源就是
/// 「版本号最大的那一版」——如果回滚是把 v2 重新标成当前、而 v3 还留着，
/// 那这条规则就不成立了，得再引入一个 `is_current` 字段去维护，而它一定会漂。
pub async fn rollback(
    release_id: u64,
    options: RollbackOptions,
) -> Result<UiamGatewayPublishVo, SvcError> {
    let db = get_db_conn()?;
    rollback_with_db(db.as_ref(), release_id, options).await
}

/// # 回滚（指定连接）
///
/// 与 [`rollback`] 相同，连接由调用方给。
///
/// ## 参数
/// - `db`：数据库连接
/// - `release_id`：目标发布记录 id
/// - `options`：回滚选项
///
/// ## 返回值
/// 同 [`rollback`]
pub async fn rollback_with_db<C>(
    db: &C,
    release_id: u64,
    options: RollbackOptions,
) -> Result<UiamGatewayPublishVo, SvcError>
where
    C: ConnectionTrait + Sync,
{
    let target = ReleaseEntity::find_by_id(to_i64(release_id)?)
        .one(db)
        .await
        .map_err(db_err)?
        .ok_or_else(|| SvcError::NotFound(format!("发布记录#{release_id}不存在")))?;

    let gateway_id = target.gateway_id as u64;
    let gateway = GatewayEntity::find_by_id(target.gateway_id)
        .one(db)
        .await
        .map_err(db_err)?
        .ok_or_else(|| SvcError::NotFound(format!("网关实例#{gateway_id}不存在")))?;

    let latest = load_latest_release(db, gateway_id).await?;
    let mut warnings = Vec::new();
    let kv_state = read_kv(&gateway.consul_key).await;

    // ---- 一、目标内容已经在 KV 里了就别再发一遍 ----
    //
    // 同样不能只信数据库：库里说「已推送」而 KV 里没有，正是最该重推的场景
    // （有人手工删了 key，或者换了 Consul）。
    if let Some(latest) = latest.as_ref() {
        let kv_same = matches!(
            &kv_state,
            KvState::Present { content, .. } if checksum(content) == target.checksum
        );
        if latest.checksum == target.checksum && latest.pushed && kv_same {
            return Ok(UiamGatewayPublishVo {
                gateway_id: U64(gateway_id),
                release_id: U64(latest.id as u64),
                version: latest.version,
                checksum: target.checksum,
                pushed: false,
                skipped: true,
                consul_key: resolve_consul_key(&gateway.consul_key),
                modify_index: None,
                structural_change: None,
                warnings,
            });
        }
    }

    if let Some(note) = drift_note(
        &kv_state,
        &resolve_consul_key(&gateway.consul_key),
        latest.as_ref(),
    ) {
        warnings.push(note);
    }

    // ---- 二、判断这次回滚要不要重启 ----
    //
    // 回滚不做完整渲染（那会把「历史内容」换成「现在渲染出来的内容」），
    // 但结构比对仍然要做：从 v5 回到 v2，监听地址很可能不一样，网关得重启。
    // 这里只解析、只比对，**不重新生成**。
    let structural = compare_structural(&target, latest.as_ref(), &mut warnings);
    ensure_restart_confirmed(structural.as_deref(), options.confirm_restart)?;

    // ---- 三、摘要以内容为准 ----
    //
    // 正常流程里 `checksum` 就是 `sha256(content)`，两者必然一致。但历史数据
    // 可能来自手工补录或早期实现，摘要对不上时不能拿错的摘要去比「内容变没变」，
    // 所以以内容重算为准，并把差异说出来。
    let actual = checksum(&target.content);
    if actual != target.checksum {
        warnings.push(format!(
            "发布记录#{} 存的摘要与内容不一致（记录 {}…，实际 {}…），已按内容重算",
            target.id,
            &target.checksum[..target.checksum.len().min(12)],
            &actual[..12]
        ));
    }

    // 回滚只改 KV。库里的配置行还是「回滚前」的样子，下次发布会把它们再推一遍，
    // 等于撤销这次回滚。这句话必须说出来，否则半夜回滚完、第二天随手发一次又炸。
    if let Some(latest) = latest.as_ref() {
        if latest.checksum != target.checksum {
            warnings.push(format!(
                "回滚只改 Consul KV，不改库里的监听器/路由/负载均衡器配置——\
                 下次发布会把库里现在的配置（v{}）重新推上去，等于撤销这次回滚",
                latest.version
            ));
        }
    }

    let outcome = create_and_push(
        db,
        gateway_id,
        &gateway.consul_key,
        &target.content,
        &actual,
        options.operator_id,
        &mut warnings,
    )
    .await?;

    Ok(UiamGatewayPublishVo {
        gateway_id: U64(gateway_id),
        release_id: U64(outcome.release_id),
        version: outcome.version,
        checksum: actual,
        pushed: true,
        skipped: false,
        consul_key: outcome.consul_key,
        modify_index: outcome.modify_index,
        structural_change: structural,
        warnings,
    })
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
/// 实例不存在时返回 `SvcError::NotFound`；监听器/路由/负载均衡器查询失败时返回库错误
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
        listeners: listeners
            .into_iter()
            .map(UiamGatewayListenerVo::from)
            .collect(),
        routes: routes.into_iter().map(UiamGatewayRouteVo::from).collect(),
        balancers: balancers
            .into_iter()
            .map(UiamGatewayBalancerVo::from)
            .collect(),
    })
}

/// # 取该实例版本号最大的一版发布记录
///
/// ## 参数
/// - `db`：数据库连接
/// - `gateway_id`：网关实例 id
///
/// ## 返回值
/// 最新一版（含 `content` / `checksum` / `pushed`）；从没发布过时返回 `None`
///
/// ## 说明
/// 返回完整 `Model` 而不是精简结构：发布要用 `checksum` 判断「内容变没变」、
/// 用 `pushed` 判断「上一版到底发出去没有」，这两条都不能靠 `content` 现算。
pub async fn load_latest_release<C>(db: &C, gateway_id: u64) -> Result<Option<ReleaseModel>, SvcError>
where
    C: ConnectionTrait + Sync,
{
    let gateway_id_i64 = to_i64(gateway_id)?;

    ReleaseEntity::find()
        .filter(crate::mo::uiam_gateway_release::Column::GatewayId.eq(gateway_id_i64))
        .order_by_desc(crate::mo::uiam_gateway_release::Column::Version)
        .limit(1)
        .one(db)
        .await
        .map_err(db_err)
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
    Ok(load_latest_release(db, gateway_id)
        .await?
        .as_ref()
        .map(to_previous))
}

/// # 一次「落库 + 推送 + 回填」的结果
struct PushOutcome {
    /// 新发布记录 id
    release_id: u64,
    /// 新版本号
    version: i32,
    /// 实际写入的完整 KV key（含环境前缀）
    consul_key: String,
    /// Consul 返回的 `ModifyIndex`
    modify_index: Option<u64>,
}

/// # 落库 → 推送 KV → 回填
///
/// 发布和回滚共用这一段：两者的区别只在「内容从哪来」，之后的动作完全一样。
///
/// ## 参数
/// - `db`：数据库连接
/// - `gateway_id`：网关实例 id
/// - `consul_key`：实例的 KV key
/// - `content`：完整 TOML
/// - `checksum`：内容的 sha256
/// - `operator_id`：操作者 ID
/// - `warnings`：调用方已有的告警，回填失败会往里追加
///
/// ## 返回值
/// [`PushOutcome`]
///
/// ## 错误
/// - KV 客户端没初始化 → 500
/// - 版本号连续冲突 → 400（并发发布，让调用方重试）
/// - 落库失败 → 对应错误
/// - 推送失败 → 500，`detail` 里说明「记录已生成、状态未推送」
async fn create_and_push<C>(
    db: &C,
    gateway_id: u64,
    consul_key: &str,
    content: &str,
    content_checksum: &str,
    operator_id: u64,
    warnings: &mut Vec<String>,
) -> Result<PushOutcome, SvcError>
where
    C: ConnectionTrait + Sync,
{
    // KV 客户端先就位：拿不到就别落库，免得留下一条永远推不出去的记录
    let kv = get_consul_kv().map_err(kv_err)?;

    let model = insert_release(db, gateway_id, content, content_checksum, operator_id).await?;

    let full_key = kv.full_key(consul_key);
    let written = match kv.put(consul_key, content).await {
        Ok(written) => written,
        Err(err) => {
            return Err(SvcError::Runtime(anyhow::anyhow!(
                "发布记录已生成（v{}，release #{}，状态为「未推送」），但写入 Consul KV [{full_key}] 失败：{err}",
                model.version, model.id
            )));
        }
    };

    // ---- 回读校验 ----
    //
    // 两个作用：
    // 1. Consul 的 KV PUT 不返回 `X-Consul-Index`，索引只能读出来
    // 2. 「响应体 true」只代表 Consul 收下了请求，不代表读出来就是这份内容
    //    （中间可能有代理、可能有另一个发布在写同一个 key）
    let modify_index = match kv.get(consul_key).await {
        Ok(Some(read)) => {
            if crate::render::checksum(&read.content) != content_checksum {
                warnings.push(format!(
                    "写入成功但回读的内容与本次渲染不一致（ModifyIndex {}）——\
                     可能有另一个发布正在同时写同一个 key，请核对",
                    read.modify_index
                ));
            }
            Some(read.modify_index)
        }
        Ok(None) => {
            warnings.push(
                "写入返回成功，但回读时 key 不存在（Consul 集群可能尚未同步），请稍后核对"
                    .to_string(),
            );
            None
        }
        Err(err) => {
            // 读不回来不影响结论：写已经成功了。只是拿不到索引。
            warn!("写入后回读 Consul KV 失败：{err}");
            None
        }
    };

    // 回填失败不判发布失败：KV 已经写成功了，配置就是生效了。
    // 这时候报错等于让用户以为没发出去、再点一次。
    if let Err(err) = mark_pushed(db, model.id, operator_id).await {
        error!(
            release_id = model.id,
            version = model.version,
            "配置已写入 Consul，但发布记录回填失败：{err:?}"
        );
        warnings.push(format!(
            "配置已写入 Consul KV（ModifyIndex {}），但发布记录 #{} 回填失败：\
             该记录仍显示「未推送」，请手工核对",
            modify_index
                .map(|index| index.to_string())
                .unwrap_or_else(|| "未知".to_string()),
            model.id
        ));
    }

    Ok(PushOutcome {
        release_id: model.id as u64,
        version: model.version,
        consul_key: written.key,
        modify_index,
    })
}

/// # 分配版本号并落库
///
/// ## 参数
/// - `db`：数据库连接
/// - `gateway_id`：网关实例 id
/// - `content` / `checksum`：本次要发布的内容与摘要
/// - `operator_id`：操作者 ID
///
/// ## 返回值
/// 落库后的完整 `Model`（含生成的雪花 ID）
///
/// ## 错误
/// 连续 3 次撞上唯一约束时返回 400「另一个发布正在进行」
///
/// ## 为什么要有重试
///
/// 「最大版本号 + 1」这个读-算-写不是原子的。两个管理员同时点发布，都会算出
/// 同一个号，只有一个能写进去——`(gateway_id, version)` 的唯一约束把第二个挡住。
/// 这时候正确的处理是重新取号再试，而不是把错误甩给用户：他的请求本身没问题，
/// 只是碰上了。重试 3 次还撞说明有东西在死循环（或者有人脚本狂点），才报出去。
async fn insert_release<C>(
    db: &C,
    gateway_id: u64,
    content: &str,
    content_checksum: &str,
    operator_id: u64,
) -> Result<ReleaseModel, SvcError>
where
    C: ConnectionTrait + Sync,
{
    /// 取号 + 落库的最大尝试次数
    const MAX_ATTEMPTS: u8 = 3;

    let gateway_id_i64 = to_i64(gateway_id)?;
    let operator_id_i64 = to_i64(operator_id)?;

    for attempt in 1..=MAX_ATTEMPTS {
        let version = next_version(db, gateway_id_i64).await?;

        let active = ReleaseActiveModel {
            gateway_id: Set(gateway_id_i64),
            version: Set(version),
            content: Set(content.to_string()),
            checksum: Set(content_checksum.to_string()),
            pushed: Set(false),
            creater_id: Set(operator_id_i64),
            ..Default::default()
        };

        match UiamGatewayReleaseDao::insert(active, db).await {
            Ok(model) => return Ok(model),
            Err(DaoError::DuplicateKey(key, value)) => {
                warn!(
                    gateway_id,
                    version,
                    attempt,
                    "版本号被并发占用（{key} = {value}），重新取号"
                );
            }
            Err(err) => return Err(SvcError::from(err)),
        }
    }

    Err(SvcError::Validation(
        validator::ValidationError::new("version_conflict").with_message(Cow::Owned(format!(
            "连续 {MAX_ATTEMPTS} 次分配版本号都被占用，可能有另一个发布正在进行，请稍后重试"
        ))),
    ))
}

/// # 取下一个可用版本号
///
/// ## 参数
/// - `db`：数据库连接
/// - `gateway_id_i64`：网关实例 id（已转成库里的 `INT8`）
///
/// ## 返回值
/// 该实例当前最大版本号 + 1；一版都没有时是 1
async fn next_version<C>(db: &C, gateway_id_i64: i64) -> Result<i32, SvcError>
where
    C: ConnectionTrait + Sync,
{
    let latest = ReleaseEntity::find()
        .filter(crate::mo::uiam_gateway_release::Column::GatewayId.eq(gateway_id_i64))
        .order_by_desc(crate::mo::uiam_gateway_release::Column::Version)
        .limit(1)
        .one(db)
        .await
        .map_err(db_err)?;

    Ok(latest.map(|model| model.version + 1).unwrap_or(1))
}

/// # 回填「已推送」
///
/// ## 参数
/// - `db`：数据库连接
/// - `release_id`：发布记录 id
/// - `operator_id`：操作者 ID
///
/// ## 返回值
/// 成功 `Ok(())`
///
/// ## 错误
/// 库错误
///
/// ## 说明
/// 只改 `pushed` / `pushed_ms` / `updater_id` / `update_ms` 四列。发布记录的主体
/// （`content` / `checksum` / `version`）落库即不可变——回滚靠新增版本，不靠改历史。
async fn mark_pushed<C>(db: &C, release_id: i64, operator_id: u64) -> Result<(), SvcError>
where
    C: ConnectionTrait + Sync,
{
    let now = wheel_rs::time_utils::now_ms() as i64;
    let active = ReleaseActiveModel {
        pushed: Set(true),
        pushed_ms: Set(Some(now)),
        updater_id: Set(to_i64(operator_id)?),
        update_ms: Set(now),
        ..Default::default()
    };

    ReleaseEntity::update_many()
        .set(active)
        .filter(crate::mo::uiam_gateway_release::Column::Id.eq(release_id))
        .exec(db)
        .await
        .map_err(db_err)?;

    Ok(())
}

/// # KV 的当前状态
///
/// 发布前必须先看清「KV 里现在是什么」，因为「要不要跳过」和「要不要提醒」
/// 都取决于它。把三种结果显式建模，比用 `Option<Option<String>>` 猜要清楚。
enum KvState {
    /// 读到了内容
    Present {
        /// 内容原文
        content: String,
        /// Consul 的 `ModifyIndex`
        modify_index: u64,
    },
    /// key 不存在（从没发布过，或者被删了）
    Missing,
    /// 读失败（Consul 不可达、ACL 拒绝、响应读不懂）
    Unknown(String),
}

/// # 读 KV 现状
///
/// ## 参数
/// - `consul_key`：实例的 `consul_key`（裸 key）
///
/// ## 返回值
/// [`KvState`]；**不返回错误**——读不到也是一种状态，由调用方决定怎么处理
///
/// ## 说明
/// 这里刻意把错误吞掉转成 [`KvState::Unknown`]：KV 读失败不该让「发布」
/// 这个动作直接失败（读和写是两条权限路径，读不到不等于写不了）。
/// 状态本身会变成一条告警，用户看得见。
async fn read_kv(consul_key: &str) -> KvState {
    let kv = match get_consul_kv() {
        Ok(kv) => kv,
        Err(err) => return KvState::Unknown(err.to_string()),
    };
    let full_key = kv.full_key(consul_key);
    match kv.get(consul_key).await {
        Ok(Some(read)) => KvState::Present {
            content: read.content,
            modify_index: read.modify_index,
        },
        Ok(None) => KvState::Missing,
        Err(err) => {
            warn!("读取 Consul KV [{full_key}] 失败：{err}");
            KvState::Unknown(err.to_string())
        }
    }
}

/// # KV 现状与数据库不一致时的那句话
///
/// 数据库记录的「上一版」和 KV 里真实内容可能对不上——有人手工改过 KV、
/// 从别的环境导入过配置、或者 key 被删了。这种情况下发布照样能成，但用户
/// 应该知道「我这一下会盖掉一份不是从这套系统发出去的东西」。
///
/// ## 参数
/// - `state`：KV 现状
/// - `full_key`：完整 KV key（含环境前缀），只用于提示语
/// - `latest`：数据库里最新一版发布记录
///
/// ## 返回值
/// 需要提醒时返回那句话；一致、或本来就什么都没有时返回 `None`
fn drift_note(state: &KvState, full_key: &str, latest: Option<&ReleaseModel>) -> Option<String> {
    match state {
        // 读不到就必须说：这次是「闭着眼睛推」
        KvState::Unknown(reason) => Some(format!(
            "无法读取 Consul KV [{full_key}] 的现状（{reason}），本次发布将直接覆盖"
        )),
        // KV 里没有，但库说推过 —— 这是最该修的状态：网关那边可能一直在用
        // 本地兜底配置跑，而管理面以为配置早就下发过了
        KvState::Missing => latest.filter(|latest| latest.pushed).map(|latest| {
            format!(
                "数据库记录显示 v{} 已推送，但 Consul KV [{full_key}] 里没有这个 key\
                 （被删了或换了 Consul？）——本次发布会重新写入",
                latest.version
            )
        }),
        KvState::Present {
            content,
            modify_index,
        } => {
            let current = checksum(content);
            match latest {
                None => Some(format!(
                    "Consul KV [{full_key}] 里已有内容（ModifyIndex {modify_index}），\
                     但数据库没有任何发布记录——可能是手工写入或从别处导入的，本次发布会覆盖它"
                )),
                Some(latest) if latest.checksum == current => None,
                Some(latest) => Some(format!(
                    "Consul KV [{full_key}] 的内容与数据库最新一版（v{}）不一致\
                     （ModifyIndex {modify_index}）——可能有人手工改过，本次发布会覆盖它",
                    latest.version
                )),
            }
        }
    }
}

/// # 比对历史内容与当前线上版本的结构差异
///
/// 回滚不重新渲染，但仍然要回答「这次回滚要不要重启」。做法是拿两边的
/// `content` 各自解析成 `AppConfig`，再走同一个 `structural_change`。
///
/// ## 参数
/// - `target`：要回滚到的发布记录
/// - `latest`：当前最新一版（线上）
/// - `warnings`：解析失败时往里追加告警
///
/// ## 返回值
/// - `Some(_)`：有结构性变更，需要重启
/// - `None`：没有结构性变更，**或者判断不出来**
///
/// ## 为什么判断不出来时不拦
///
/// 回滚是应急动作。历史内容读不懂（gatex 升级后字段变了、早期数据手工补录）
/// 时，最坏的结果是「推上去网关起不来」——但那也得推了才知道，而且回滚的
/// 目标本来就是「回到一个曾经能跑的版本」。这里只告警，把决定权留给用户。
fn compare_structural(
    target: &ReleaseModel,
    latest: Option<&ReleaseModel>,
    warnings: &mut Vec<String>,
) -> Option<String> {
    let Some(latest) = latest else {
        // 没有「当前版本」可比：这种情况只会出现在 target 就是唯一一版时，
        // 而那种情况下 rollback 会先被「内容已在线上」拦掉。
        return None;
    };

    let old = toml::from_str::<gatex_svr::config::AppConfig>(&latest.content);
    let new = toml::from_str::<gatex_svr::config::AppConfig>(&target.content);
    match (old, new) {
        (Ok(old), Ok(new)) => gatex_svr::config::structural_change(&old, &new),
        (Err(err), _) => {
            warnings.push(format!(
                "无法判断回滚是否需要重启：当前版本 v{} 的内容读不懂（{err}），\
                 请自行确认网关是否需要重启",
                latest.version
            ));
            None
        }
        (_, Err(err)) => {
            warnings.push(format!(
                "无法判断回滚是否需要重启：目标版本 v{} 的内容读不懂（{err}）。\
                 这份内容可能来自更早的 gatex 版本，推上去可能装不起来",
                target.version
            ));
            None
        }
    }
}

/// # 结构性变更的确认闸门
///
/// ## 参数
/// - `structural`：结构变更说明
/// - `confirmed`：调用方是否已确认
///
/// ## 返回值
/// 无结构变更、或已确认时 `Ok(())`
///
/// ## 错误
/// 有结构变更但没确认时返回 400，`msg` 里带完整原因和下一步动作
///
/// ## 为什么要这道闸
///
/// 结构性变更意味着网关进程要重启，期间所有在途请求会断。这是个几十秒的
/// 服务中断，不能因为「顺手点了一下发布」就发生。所以强制走「先预览 →
/// 看见这句话 → 带上 confirmRestart 再来」。
fn ensure_restart_confirmed(structural: Option<&str>, confirmed: bool) -> Result<(), SvcError> {
    match structural {
        Some(change) if !confirmed => Err(SvcError::Validation(
            validator::ValidationError::new("structural_change").with_message(Cow::Owned(format!(
                "{change}\n本次发布会重启网关（期间在途请求会断），确认无误后带上 confirmRestart=true 重新提交"
            ))),
        )),
        _ => Ok(()),
    }
}

/// # 解析出「会写到哪个 KV key」
///
/// 跳过发布时不写 KV，但返回值里仍要给出完整 key，否则前端没法核对
/// 「这条记录对应 KV 里的哪一个键」。
///
/// ## 参数
/// - `key`：实例的 `consul_key`（裸 key）
///
/// ## 返回值
/// 含环境前缀的完整 key；KV 客户端没初始化时退回裸 key
fn resolve_consul_key(key: &str) -> String {
    get_consul_kv()
        .map(|kv| kv.full_key(key))
        .unwrap_or_else(|_| key.to_string())
}

/// 把发布记录精简成渲染器要的「上一版」
fn to_previous(model: &ReleaseModel) -> PreviousRelease {
    PreviousRelease {
        id: model.id as u64,
        content: model.content.clone(),
    }
}

/// 把渲染结果拍成预览 VO
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
        validator::ValidationError::new("render").with_message(Cow::Owned(err.to_string())),
    )
}

/// # KV 错误转成 `SvcError`
///
/// 走 `Runtime`（500）而不是 `Validation`（400）：Consul 写不进去是**服务端
/// 侧**的问题（依赖挂了、ACL 没配、网络不通），不是调用方参数错了。让用户
/// 改参数是没用的。
///
/// `msg` 会是「运行时错误」，真正的原因在 `detail` 里——这是框架的固定映射，
/// 换来的是「5xx 就是服务端的事」这个一眼能看懂的信号。
fn kv_err(err: crate::kv::KvError) -> SvcError {
    SvcError::Runtime(anyhow::anyhow!("{err}"))
}

/// # `u64` 转 `i64`
///
/// 雪花 ID 不会超出 `i64`，但数据库列是 `INT8`，越界时给一句人话而不是让
/// `as` 静默截断。
fn to_i64(id: u64) -> Result<i64, SvcError> {
    i64::try_from(id).map_err(|_| {
        SvcError::Validation(
            validator::ValidationError::new("id").with_message(Cow::Borrowed("ID 超出范围")),
        )
    })
}

/// 库错误转成 `SvcError`
fn db_err(err: sea_orm::DbErr) -> SvcError {
    SvcError::from(DaoError::parse_db_err(err))
}
