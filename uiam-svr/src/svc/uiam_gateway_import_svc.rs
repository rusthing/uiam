//! # 导入现有 TOML
//!
//! 把一份已经在跑的网关配置拆成结构化数据写进库里，是「接管线上网关」的第一
//! 步：库里没有监听器/路由/负载均衡器时，发布渲染出来是**空配置**，直接点
//! 发布等于把线上的路由全删掉。
//!
//! ## 顺序即安全
//!
//! 1. 解析源 TOML（两份视图：强类型 + 原始顶层表）
//! 2. 拆成 [`ImportPlan`]
//! 3. **模拟渲染**：拿 plan 造一份假的渲染输入，走发布时同一个 `render()`
//! 4. **往返比对**：渲染结果必须与源 TOML 语义等价，否则中止（不写库）
//! 5. `dryRun` 到此为止，返回计数 + 与 KV 的差异
//! 6. 事务内整段替换 → **事务内从库里重新渲染再复验一次** → 提交
//! 7. 提交后与 KV 里的线上内容做语义比对，告诉用户「发布会不会改变线上行为」
//!
//! 第 4 步拦的是「拆错了」，第 6 步拦的是「DAO 写坏了」。两次比对的参照物
//! 不同：前者比源 TOML，后者比源 TOML 但走的是真实的读库路径。
//!
//! ## 为什么是整段替换而不是合并
//!
//! 导入的语义是「让库里的数据等于这份 TOML」。合并（按名字对齐、缺的补、
//! 多的留）听起来温柔，实际会留下「这份 TOML 里没有、但库里还挂着」的路由
//! ——那正好是接管时最危险的状态：以为对齐了，实际线上多跑几条规则。

use crate::dao::{UiamGatewayBalancerDao, UiamGatewayListenerDao, UiamGatewayRouteDao};
use crate::kv::get_consul_kv;
use crate::mo::uiam_gateway::ActiveModel as GatewayActiveModel;
use crate::mo::uiam_gateway::Entity as GatewayEntity;
use crate::mo::uiam_gateway_balancer::ActiveModel as BalancerActiveModel;
use crate::mo::uiam_gateway_balancer::Column as BalancerColumn;
use crate::mo::uiam_gateway_balancer::Entity as BalancerEntity;
use crate::mo::uiam_gateway_listener::ActiveModel as ListenerActiveModel;
use crate::mo::uiam_gateway_listener::Column as ListenerColumn;
use crate::mo::uiam_gateway_listener::Entity as ListenerEntity;
use crate::mo::uiam_gateway_route::ActiveModel as RouteActiveModel;
use crate::mo::uiam_gateway_route::Column as RouteColumn;
use crate::mo::uiam_gateway_route::Entity as RouteEntity;
use crate::render::{ImportPlan, RenderInput, RenderedConfig, compare, parse_source, plan_from_source, render, verify};
use gatex_svr::config::AppConfig;
use robotech::api::U64;
use robotech::dao::DaoError;
use robotech::db::get_db_conn;
use robotech::svc::SvcError;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set, TransactionTrait};
use std::borrow::Cow;
use tracing::warn;
use uiam_api::vo::{UiamGatewayImportVo, UiamGatewayVo};

/// # 导入选项
#[derive(Debug, Clone)]
pub struct ImportOptions {
    /// 操作者 ID（来自 `X-User-Id`），记进新插入记录的 `creater_id`
    pub operator_id: u64,
    /// 只校验、不落库
    pub dry_run: bool,
    /// 同时把实例的 `consul_key` 改成这个值；`None` 表示不动
    pub consul_key: Option<String>,
}

/// # 导入一份 TOML
///
/// ## 参数
/// - `gateway_id`：要导入到哪个网关实例
/// - `toml_text`：完整的网关配置 TOML
/// - `options`：操作者、是否预演、是否改 `consul_key`
///
/// ## 返回值
/// [`UiamGatewayImportVo`]：计数、导入后渲染出的 TOML 与摘要、与 KV 的比对结果、告警
///
/// ## 错误
/// - 实例不存在：404
/// - TOML 读不懂 / 往返比对不一致 / 配置装不起来：400，`msg` 里是给用户看的原因
/// - 落库失败：对应错误；事务已回滚，库里的数据保持导入前的样子
pub async fn import_gateway(
    gateway_id: u64,
    toml_text: &str,
    options: ImportOptions,
) -> Result<UiamGatewayImportVo, SvcError> {
    let db = get_db_conn()?;
    import_with_db(db.as_ref(), gateway_id, toml_text, options).await
}

/// # 导入一份 TOML（指定连接）
///
/// 与 [`import_gateway`] 相同，连接由调用方给。
///
/// ## 参数
/// - `db`：数据库连接
/// - `gateway_id`：网关实例 id
/// - `toml_text`：完整 TOML
/// - `options`：导入选项
///
/// ## 返回值
/// 同 [`import_gateway`]
pub async fn import_with_db(
    db: &sea_orm::DatabaseConnection,
    gateway_id: u64,
    toml_text: &str,
    options: ImportOptions,
) -> Result<UiamGatewayImportVo, SvcError> {
    let gateway_id_i64 = to_i64(gateway_id)?;
    let gateway = GatewayEntity::find_by_id(gateway_id_i64)
        .one(db)
        .await
        .map_err(db_err)?
        .ok_or_else(|| SvcError::NotFound(format!("网关实例#{gateway_id}不存在")))?;

    // ---- 一、解析 + 拆解 ----
    let (original, original_raw) = parse_source(toml_text).map_err(import_err)?;
    let plan = plan_from_source(&original, &original_raw).map_err(import_err)?;
    let mut warnings = plan.warnings.clone();

    // ---- 二、目标 consul_key ----
    let old_key = gateway.consul_key.clone();
    let consul_key = resolve_consul_key(&old_key, options.consul_key.as_deref())?;
    if consul_key != old_key {
        warnings.push(format!(
            "实例的 Consul KV key 由 [{old_key}] 改为 [{consul_key}]——\
             发布时写的是新 key，旧 key 里的内容不会自动清理"
        ));
    }

    // ---- 三、模拟渲染 + 往返比对 ----
    let simulated = render(&plan.to_render_input(simulated_gateway(&gateway, &plan, &consul_key)), None)
        .map_err(import_err)?;
    let diffs = verify(&original, &original_raw, &simulated).map_err(import_err)?;
    if !diffs.is_empty() {
        return Err(roundtrip_error("导入结果与源 TOML 不等价，已中止（未写库）", &diffs));
    }

    if options.dry_run {
        let (kv_checked, kv_matches, kv_diff) = compare_with_kv(&consul_key, &simulated.app_config).await;
        return Ok(build_vo(
            gateway_id,
            true,
            false,
            &plan,
            &consul_key,
            &simulated,
            kv_checked,
            kv_matches,
            kv_diff,
            warnings,
        ));
    }

    // ---- 四、事务内整段替换 ----
    let txn = db.begin().await.map_err(db_err)?;

    if let Err(err) = apply_plan(&txn, gateway_id_i64, &plan, options.operator_id, &consul_key).await {
        let _ = txn.rollback().await;
        return Err(err);
    }

    // ---- 五、事务内复验：从库里重新读出来渲染 ----
    //
    // 这一步和第 3 步不是重复劳动：第 3 步验的是「拆得对不对」，这里验的是
    // 「DAO 有没有写坏」——`addrs_json` 少一个字段、`sort_no` 全写成 1、
    // 路由挂错监听器，都只有真的读回来才看得见。
    let rendered = match reload_and_render(&txn, gateway_id).await {
        Ok(rendered) => rendered,
        Err(err) => {
            let _ = txn.rollback().await;
            return Err(err);
        }
    };
    let recheck = compare(&original, &rendered.app_config).map_err(import_err)?;
    if !recheck.is_empty() {
        let _ = txn.rollback().await;
        return Err(roundtrip_error(
            "落库后从库里重新渲染的结果与源 TOML 不等价，已回滚（库里的数据保持导入前的样子）",
            &recheck,
        ));
    }

    txn.commit().await.map_err(db_err)?;

    // ---- 六、与线上 KV 比对 ----
    let (kv_checked, kv_matches, kv_diff) = compare_with_kv(&consul_key, &rendered.app_config).await;

    Ok(build_vo(
        gateway_id,
        false,
        true,
        &plan,
        &consul_key,
        &rendered,
        kv_checked,
        kv_matches,
        kv_diff,
        warnings,
    ))
}

/// # 事务内整段替换该实例的结构化数据
///
/// ## 参数
/// - `db`：事务连接
/// - `gateway_id`：网关实例 id（库里的 `INT8`）
/// - `plan`：导入计划
/// - `operator_id`：操作者 ID
/// - `consul_key`：要写进实例行的 key
///
/// ## 返回值
/// 成功 `Ok(())`
///
/// ## 错误
/// 任何一条写失败都直接返回；调用方负责回滚
///
/// ## 删除顺序
///
/// 先删路由再删监听器：路由的外键是 `ON DELETE CASCADE`，理论上删监听器就
/// 带走了，但显式删一遍能保证「没有级联删除的库（例如某些 MySQL 配置）」
/// 也不会留下孤儿。删实例级负载均衡器没有依赖，最后删。
async fn apply_plan<C>(
    db: &C,
    gateway_id: i64,
    plan: &ImportPlan,
    operator_id: u64,
    consul_key: &str,
) -> Result<(), SvcError>
where
    C: ConnectionTrait + Sync,
{
    let operator_id_i64 = to_i64(operator_id)?;
    let now = wheel_rs::time_utils::now_ms() as i64;

    // ---- 实例级列 ----
    let active = GatewayActiveModel {
        extra_toml: Set(plan.extra_toml.clone()),
        ops_json: Set(plan.ops_json.clone()),
        static_json: Set(plan.static_json.clone()),
        upstream_error_json: Set(plan.upstream_error_json.clone()),
        consul_key: Set(consul_key.to_string()),
        updater_id: Set(operator_id_i64),
        update_ms: Set(now),
        ..Default::default()
    };
    GatewayEntity::update_many()
        .set(active)
        .filter(crate::mo::uiam_gateway::Column::Id.eq(gateway_id))
        .exec(db)
        .await
        .map_err(db_err)?;

    // ---- 清空旧数据 ----
    let listener_ids: Vec<i64> = ListenerEntity::find()
        .filter(ListenerColumn::GatewayId.eq(gateway_id))
        .all(db)
        .await
        .map_err(db_err)?
        .into_iter()
        .map(|model| model.id)
        .collect();

    if !listener_ids.is_empty() {
        RouteEntity::delete_many()
            .filter(RouteColumn::ListenerId.is_in(listener_ids))
            .exec(db)
            .await
            .map_err(db_err)?;
    }
    ListenerEntity::delete_many()
        .filter(ListenerColumn::GatewayId.eq(gateway_id))
        .exec(db)
        .await
        .map_err(db_err)?;
    BalancerEntity::delete_many()
        .filter(BalancerColumn::GatewayId.eq(gateway_id))
        .exec(db)
        .await
        .map_err(db_err)?;

    // ---- 插入新数据 ----
    for listener in &plan.listeners {
        let model = UiamGatewayListenerDao::insert(
            ListenerActiveModel {
                gateway_id: Set(gateway_id),
                kind: Set(listener.kind as i16),
                sort_no: Set(listener.sort_no),
                addrs_json: Set(listener.addrs_json.clone()),
                enabled: Set(true),
                creater_id: Set(operator_id_i64),
                ..Default::default()
            },
            db,
        )
        .await
        .map_err(SvcError::from)?;

        for route in &listener.routes {
            UiamGatewayRouteDao::insert(
                RouteActiveModel {
                    listener_id: Set(model.id),
                    sort_no: Set(route.sort_no),
                    name: Set(route.name.clone()),
                    matcher_json: Set(route.matcher_json.clone()),
                    to_json: Set(route.to_json.clone()),
                    log_json: Set(route.log_json.clone()),
                    enabled: Set(true),
                    creater_id: Set(operator_id_i64),
                    ..Default::default()
                },
                db,
            )
            .await
            .map_err(SvcError::from)?;
        }
    }

    for balancer in &plan.balancers {
        UiamGatewayBalancerDao::insert(
            BalancerActiveModel {
                gateway_id: Set(gateway_id),
                name: Set(balancer.name.clone()),
                config_json: Set(balancer.config_json.clone()),
                enabled: Set(true),
                creater_id: Set(operator_id_i64),
                ..Default::default()
            },
            db,
        )
        .await
        .map_err(SvcError::from)?;
    }

    Ok(())
}

/// # 从库里重新读出来渲染
///
/// 与 `render_preview_with_db` 等价，但走的是调用方给的连接（可能是事务），
/// 所以事务里能看见刚写入还没提交的数据。
async fn reload_and_render<C>(db: &C, gateway_id: u64) -> Result<RenderedConfig, SvcError>
where
    C: ConnectionTrait + Sync,
{
    let input: RenderInput = crate::svc::load_render_input(db, gateway_id).await?;
    render(&input, None).map_err(import_err)
}

/// # 与 Consul KV 里的线上内容比对
///
/// ## 参数
/// - `consul_key`：实例的裸 key
/// - `app`：库里现在的配置（导入后渲染出来的那份）
///
/// ## 返回值
/// `(是否完成了比对, 是否一致, 差异列表)`
///
/// ## 为什么读失败不算错
///
/// 读不到 KV 不影响导入本身（写库已经成功了）。这时候把原因放进 `kv_diff`，
/// 让用户知道「这次没能确认库里跟线上是不是一致」就够了——报错会让人以为
/// 导入失败，反而更糟。
async fn compare_with_kv(
    consul_key: &str,
    app: &AppConfig,
) -> (bool, Option<bool>, Vec<String>) {
    let kv = match get_consul_kv() {
        Ok(kv) => kv,
        Err(err) => {
            return (
                false,
                None,
                vec![format!("Consul KV 客户端未初始化（{err}），未能与线上内容比对")],
            );
        }
    };
    let full_key = kv.full_key(consul_key);

    match kv.get(consul_key).await {
        Ok(Some(read)) => match toml::from_str::<AppConfig>(&read.content) {
            Ok(online) => match compare(&online, app) {
                Ok(diff) => (true, Some(diff.is_empty()), diff),
                Err(err) => (true, None, vec![format!("与线上内容比对失败：{err}")]),
            },
            Err(err) => (
                false,
                None,
                vec![format!(
                    "KV [{full_key}] 里的内容无法解析成网关配置（{err}），未能比对"
                )],
            ),
        },
        Ok(None) => (
            false,
            None,
            vec![format!(
                "KV [{full_key}] 里没有这个 key，无从比对（首次发布？）"
            )],
        ),
        Err(err) => {
            warn!("读取 Consul KV [{full_key}] 失败：{err}");
            (false, None, vec![format!("读取 KV [{full_key}] 失败（{err}），未能比对")])
        }
    }
}

/// # 拼一份用于模拟渲染的实例 VO
///
/// 用库里那行做底（`code` / `name` / `enabled` 等），把四个 JSON 列与
/// `consul_key` 换成**计划里的**值——模拟渲染要验的是「这份 plan 渲染出来
/// 什么样」，不是「库里现在什么样」。
fn simulated_gateway(
    gateway: &crate::mo::uiam_gateway::Model,
    plan: &ImportPlan,
    consul_key: &str,
) -> UiamGatewayVo {
    let mut vo = UiamGatewayVo::from(gateway.clone());
    vo.extra_toml = plan.extra_toml.clone();
    vo.ops_json = plan.ops_json.clone();
    vo.static_json = plan.static_json.clone();
    vo.upstream_error_json = plan.upstream_error_json.clone();
    vo.consul_key = consul_key.to_string();
    vo
}

/// # 拼返回体
#[allow(clippy::too_many_arguments)]
fn build_vo(
    gateway_id: u64,
    dry_run: bool,
    applied: bool,
    plan: &ImportPlan,
    consul_key: &str,
    rendered: &RenderedConfig,
    kv_checked: bool,
    kv_matches: Option<bool>,
    kv_diff: Vec<String>,
    warnings: Vec<String>,
) -> UiamGatewayImportVo {
    UiamGatewayImportVo {
        gateway_id: U64(gateway_id),
        dry_run,
        applied,
        http_listeners: plan.http_listener_count() as u32,
        tcp_listeners: plan.tcp_listener_count() as u32,
        http_routes: plan.http_route_count() as u32,
        tcp_routes: plan.tcp_route_count() as u32,
        balancers: plan.balancers.len() as u32,
        consul_key: consul_key.to_string(),
        checksum: rendered.checksum.clone(),
        toml: rendered.toml.clone(),
        kv_checked,
        kv_matches,
        kv_diff,
        warnings,
    }
}

/// # 归一化目标 `consul_key`
///
/// ## 参数
/// - `current`：实例当前的 key
/// - `requested`：调用方要改成的新 key；`None` 表示不动
///
/// ## 返回值
/// 最终要写进实例行的 key
///
/// ## 错误
/// 空、超长、带 `/` 时返回 400
///
/// ## 为什么不允许带 `/`
///
/// 环境前缀（`dev/`）是**部署属性**，由 `[consul] key-prefix` 统一加。key 里
/// 再带一段 `/` 会得到 `dev/prod/gatex-rs-svr00.toml` 这种谁也想不到的路径，
/// 而且和「这个 key 属于哪个环境」的语义直接冲突。
fn resolve_consul_key(current: &str, requested: Option<&str>) -> Result<String, SvcError> {
    let Some(requested) = requested else {
        return Ok(current.to_string());
    };

    let key = requested.trim();
    if key.is_empty() {
        return Err(validation("consulKey", "Consul KV key 不能为空"));
    }
    if key.chars().count() > 200 {
        return Err(validation("consulKey", "Consul KV key 长度不能超过 200"));
    }
    if key.contains('/') {
        return Err(validation(
            "consulKey",
            "Consul KV key 不能带 `/`：环境前缀由部署配置（key-prefix）统一添加",
        ));
    }

    Ok(key.to_string())
}

/// 往返比对失败时的错误
fn roundtrip_error(title: &str, diffs: &[String]) -> SvcError {
    validation("import_roundtrip", &format!("{title}：\n{}", diffs.join("\n")))
}

/// 拼一个 400 错误
fn validation(field: &'static str, message: &str) -> SvcError {
    SvcError::Validation(
        validator::ValidationError::new(field).with_message(Cow::Owned(message.to_string())),
    )
}

/// # 导入期错误转成 `SvcError`
///
/// 走 `Validation`（400）而不是 `Runtime`（500）：TOML 读不懂、配置装不起来
/// 都是**调用方给的输入**有问题，`msg` 就是原因本身，前端可以直接弹出来。
fn import_err(err: crate::render::RenderError) -> SvcError {
    validation("import", &err.to_string())
}

/// `u64` 转 `i64`，越界给一句人话
fn to_i64(id: u64) -> Result<i64, SvcError> {
    i64::try_from(id).map_err(|_| validation("id", "ID 超出范围"))
}

/// 库错误转成 `SvcError`
fn db_err(err: sea_orm::DbErr) -> SvcError {
    SvcError::from(DaoError::parse_db_err(err))
}
