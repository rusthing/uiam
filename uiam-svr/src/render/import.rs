//! # 导入现有 TOML
//!
//! 渲染是「结构化数据 → TOML」，这里是它的**逆运算**：把一份已经在跑的
//! `gatex` 配置拆成监听器 / 路由 / 负载均衡器 / 实例级 JSON 列。
//!
//! ## 为什么必须先做「模拟渲染 + 往返比对」
//!
//! 导入是唯一一个「把线上正在跑的配置反向拆进库里」的动作。拆错了不会立刻
//! 报错——库里多一条少一条路由都能存进去，直到下一次发布把错误的配置推上
//! 网关才炸。所以这里不允许「解析成功就落库」：
//!
//! 1. [`plan_from_toml`] 解析出 [`ImportPlan`]（纯函数，不碰库）
//! 2. 用这份 plan 造一个假的 [`RenderInput`]，走**真正的** [`render`]
//! 3. 把渲染结果与原始 TOML 做**语义签名**比对（[`verify`]）
//! 4. 只有比对全等才允许落库
//!
//! 第 2 步走的是发布时同一个 `render()`，所以「导入能通过比对」等价于
//! 「按这份数据发布出来的配置与线上正在跑的那份语义一致」。
//!
//! ## 为什么比「语义签名」而不是比字节
//!
//! 渲染会规范化书写：键序重排、默认值补全（`[static]` 会补出 `root-dir`）、
//! 注释全部丢掉。逐字节比必然不等，而且**永远**不等，那这个闸门就成了摆设。
//!
//! 所以比的是「把每个部件重新序列化一遍之后的字符串」：两边都经过同一个
//! `Serialize`，格式差异被抹平，剩下的差异才是真差异。
//!
//! ## 哪些东西进不了结构化表
//!
//! `[pingora-conf]`（以及任何 gatex 没定义的顶层键）没有对应的表，只能整段
//! 塞进实例的 `extra_toml`。渲染时 `extra_toml` 会「只补缺失的顶层键」原样
//! 带回，所以往返是闭的——但**必须**在告警里说清楚，否则用户会以为界面上
//! 能看到 pingora 的线程数。

use crate::render::{RenderError, RenderInput, RenderedConfig};
use gatex_svr::config::{AppConfig, RouteConfig, RouteMatcherConfig, TcpRouteConfig};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use uiam_api::dic::ListenerKind;
use uiam_api::vo::{
    UiamGatewayBalancerVo, UiamGatewayListenerVo, UiamGatewayRouteVo, UiamGatewayVo,
};

/// 由结构化数据渲染的顶层段。
///
/// 出现在这份清单里的键**不能**进 `extra_toml`：渲染时它们由数据库生成，
/// `extra_toml` 里同名段会被忽略（并告警）。反过来，不在这份清单里的顶层键
/// （`pingora-conf` 及任何未知键）必须进 `extra_toml`，否则会被静默丢掉。
const STRUCTURED_KEYS: [&str; 6] = [
    "balancers",
    "static",
    "listeners",
    "tcp-listeners",
    "upstream-error",
    "ops",
];

/// 往返比对最多列出多少条差异
///
/// 差异一多，逐条列出来只会淹没真正重要的那几条（通常第一条就是根因）。
const MAX_DIFF_ITEMS: usize = 20;

/// # 导入计划
///
/// 一份 TOML 拆解后的结果，**还没有落库**。字段与 `uiam_gateway*` 各表的列
/// 一一对应，`svc` 层拿到它之后只管往库里写，不再做任何解析。
#[derive(Debug, Clone)]
pub struct ImportPlan {
    /// 实例级：进不了结构化表的顶层段（`pingora-conf` 等）
    pub extra_toml: Option<String>,
    /// 实例级：`[ops]`，原始 TOML 没有这一段时为 `None`
    pub ops_json: Option<String>,
    /// 实例级：`[static]`，原始 TOML 没有这一段时为 `None`
    pub static_json: Option<String>,
    /// 实例级：`[upstream-error]`，原始 TOML 没有这一段时为 `None`
    pub upstream_error_json: Option<String>,
    /// 监听器（HTTP 在前、TCP 在后，各自保持原始顺序）
    pub listeners: Vec<PlannedListener>,
    /// 负载均衡器（按名字排序，保证同一份 TOML 每次导入结果一致）
    pub balancers: Vec<PlannedBalancer>,
    /// 拆解过程中值得告诉用户的事
    pub warnings: Vec<String>,
}

/// 计划中的一条监听器
#[derive(Debug, Clone)]
pub struct PlannedListener {
    /// `ListenerKind::Http` 落 `listeners`，`Tcp` 落 `tcp-listeners`
    pub kind: ListenerKind,
    /// 渲染顺序，从 1 开始
    pub sort_no: i32,
    /// 绑定地址（`Vec<ListenerAddrConfig>` 的 JSON）
    pub addrs_json: String,
    /// 该监听器下的路由
    pub routes: Vec<PlannedRoute>,
}

/// 计划中的一条路由
#[derive(Debug, Clone)]
pub struct PlannedRoute {
    /// 组内顺序，从 1 开始
    pub sort_no: i32,
    /// 展示名，由匹配条件推导（TOML 里没有名字这个概念）
    pub name: String,
    /// 匹配条件（JSON）
    pub matcher_json: String,
    /// 转发目标（JSON）
    pub to_json: String,
    /// 日志配置（JSON）；TOML 里 `log` 有默认值，这里总是写出显式值
    pub log_json: Option<String>,
}

/// 计划中的一个负载均衡器
#[derive(Debug, Clone)]
pub struct PlannedBalancer {
    /// 名字（`balancers` 是 map，名字就是键）
    pub name: String,
    /// 配置（`BalancerConfig` 的 JSON，带 `type` 判别字段）
    pub config_json: String,
}

impl ImportPlan {
    /// # 造一份用于「模拟渲染」的输入
    ///
    /// 只为了在落库前验证往返一致，**不要**拿它的 id 去写库——这里的 id 是
    /// 人造的（监听器 1..n、路由 1000000..、负载均衡器 2000000..），真实 id
    /// 由 DAO 插入时生成。
    ///
    /// ## 参数
    /// - `gateway`：实例本身（提供 `code` / `extra_toml` / `ops_json` 等）
    ///
    /// ## 返回值
    /// 可直接交给 [`render`] 的 [`RenderInput`]
    pub fn to_render_input(&self, gateway: UiamGatewayVo) -> RenderInput {
        let mut listeners = Vec::new();
        let mut routes = Vec::new();
        let mut listener_id = 0u64;
        let mut route_id = 1_000_000u64;

        for listener in &self.listeners {
            listener_id += 1;
            listeners.push(UiamGatewayListenerVo {
                id: listener_id.into(),
                gateway_id: gateway.id,
                kind: listener.kind,
                sort_no: listener.sort_no,
                addrs_json: listener.addrs_json.clone(),
                remark: None,
                enabled: true,
                creater_id: 0u64.into(),
                create_ms: 0u64.into(),
                updater_id: 0u64.into(),
                update_ms: 0u64.into(),
            });

            for route in &listener.routes {
                route_id += 1;
                routes.push(UiamGatewayRouteVo {
                    id: route_id.into(),
                    listener_id: listener_id.into(),
                    sort_no: route.sort_no,
                    name: route.name.clone(),
                    matcher_json: route.matcher_json.clone(),
                    to_json: route.to_json.clone(),
                    log_json: route.log_json.clone(),
                    enabled: true,
                    creater_id: 0u64.into(),
                    create_ms: 0u64.into(),
                    updater_id: 0u64.into(),
                    update_ms: 0u64.into(),
                });
            }
        }

        let balancers = self
            .balancers
            .iter()
            .enumerate()
            .map(|(index, balancer)| UiamGatewayBalancerVo {
                id: (2_000_000 + index as u64).into(),
                gateway_id: gateway.id,
                name: balancer.name.clone(),
                config_json: balancer.config_json.clone(),
                remark: None,
                enabled: true,
                creater_id: 0u64.into(),
                create_ms: 0u64.into(),
                updater_id: 0u64.into(),
                update_ms: 0u64.into(),
            })
            .collect();

        RenderInput {
            gateway,
            listeners,
            routes,
            balancers,
        }
    }

    /// 监听器数量（HTTP）
    pub fn http_listener_count(&self) -> usize {
        self.listeners
            .iter()
            .filter(|listener| listener.kind == ListenerKind::Http)
            .count()
    }

    /// 监听器数量（TCP）
    pub fn tcp_listener_count(&self) -> usize {
        self.listeners
            .iter()
            .filter(|listener| listener.kind == ListenerKind::Tcp)
            .count()
    }

    /// 路由数量（HTTP）
    pub fn http_route_count(&self) -> usize {
        self.listeners
            .iter()
            .filter(|listener| listener.kind == ListenerKind::Http)
            .map(|listener| listener.routes.len())
            .sum()
    }

    /// 路由数量（TCP）
    pub fn tcp_route_count(&self) -> usize {
        self.listeners
            .iter()
            .filter(|listener| listener.kind == ListenerKind::Tcp)
            .map(|listener| listener.routes.len())
            .sum()
    }
}

/// # 解析源 TOML
///
/// 返回两份视图：
/// - `AppConfig`：强类型配置，用来做语义签名比对
/// - `toml::Table`：原始顶层表，用来查「原文件里到底有没有 `[ops]` 这一段」
///   以及把 gatex 不认识的键（`pingora-conf` 等）捞进 `extra_toml`
///
/// ## 参数
/// - `text`：完整的网关配置 TOML
///
/// ## 返回值
/// `(AppConfig, 顶层表)`
///
/// ## 错误
/// [`RenderError::SourceToml`]：不是合法 TOML，或字段类型对不上
pub fn parse_source(text: &str) -> Result<(AppConfig, toml::Table), RenderError> {
    let raw: toml::Table = toml::from_str(text).map_err(|source| RenderError::SourceToml { source })?;
    let app: AppConfig = toml::from_str(text).map_err(|source| RenderError::SourceToml { source })?;
    Ok((app, raw))
}

/// # 把一份 TOML 拆成导入计划
///
/// ## 参数
/// - `text`：完整的网关配置 TOML（通常是 Consul KV 里那一份）
///
/// ## 返回值
/// [`ImportPlan`]；`warnings` 里说明哪些段只能进 `extra_toml`
///
/// ## 错误
/// - [`RenderError::SourceToml`]：文本不是合法 TOML，或字段类型对不上
///   （例如 `port = "80"`）。错误信息带行列号，用户能自己定位
/// - [`RenderError::JsonSerialize`]：某个配置类型只实现了反序列化（框架 bug）
pub fn plan_from_toml(text: &str) -> Result<ImportPlan, RenderError> {
    let (app, raw) = parse_source(text)?;
    plan_from_source(&app, &raw)
}

/// # 由已解析的源拆出导入计划
///
/// 与 [`plan_from_toml`] 相同，只是源已经解析好了——调用方通常还要拿
/// `AppConfig` 做往返比对，解析两次没有意义。
///
/// ## 参数
/// - `app`：强类型配置
/// - `raw`：同一份文本的顶层表
///
/// ## 返回值
/// [`ImportPlan`]
pub fn plan_from_source(app: &AppConfig, raw: &toml::Table) -> Result<ImportPlan, RenderError> {
    let mut warnings = Vec::new();

    // ---- 进不了结构化表的顶层段 ----
    let mut extra = toml::Table::new();
    for (key, value) in raw {
        if !STRUCTURED_KEYS.contains(&key.as_str()) {
            extra.insert(key.clone(), value.clone());
        }
    }
    let extra_toml = if extra.is_empty() {
        None
    } else {
        let keys: Vec<String> = extra.keys().cloned().collect();
        warnings.push(format!(
            "顶层段 [{}] 没有对应的结构化表，已原样存进实例的「附加 TOML」；\
             发布时会原样带回，但在界面上看不到里面的字段",
            keys.join("], [")
        ));
        Some(toml::to_string_pretty(&extra)?)
    };

    // ---- 实例级可选段 ----
    //
    // 判断依据是「原始 TOML 里有没有这一段」，不是「解析出来的值是否等于默认值」。
    // 后者会让一份显式写了 `[static]`（哪怕全是默认值）的配置在导入后变成
    // 「没有 static 段」——语义上一样，但用户在界面上会以为配置丢了。
    let ops_json = if raw.contains_key("ops") {
        Some(to_json(&app.ops)?)
    } else {
        None
    };
    let static_json = if raw.contains_key("static") {
        Some(to_json(&app.r#static)?)
    } else {
        None
    };
    let upstream_error_json = if raw.contains_key("upstream-error") {
        Some(to_json(&app.upstream_error)?)
    } else {
        None
    };

    // ---- 监听器 ----
    let mut listeners = Vec::new();
    for (index, listener) in app.listeners.iter().enumerate() {
        listeners.push(PlannedListener {
            kind: ListenerKind::Http,
            sort_no: index as i32 + 1,
            addrs_json: to_json(&listener.addrs)?,
            routes: plan_http_routes(&listener.routes)?,
        });
    }
    let http_count = listeners.len();
    for (index, listener) in app.tcp_listeners.iter().enumerate() {
        listeners.push(PlannedListener {
            kind: ListenerKind::Tcp,
            sort_no: (http_count + index) as i32 + 1,
            addrs_json: to_json(&listener.addrs)?,
            routes: plan_tcp_routes(&listener.routes)?,
        });
    }

    if listeners.is_empty() {
        warnings.push(
            "这份 TOML 里没有任何监听器，导入后该实例的配置将是空的——\
             确认不是拿错了文件"
                .to_string(),
        );
    }

    // ---- 负载均衡器 ----
    //
    // `balancers` 在 gatex 里是 map，`HashMap` 的遍历顺序不稳定。这里按名字
    // 排序后再拆，保证同一份 TOML 每次导入落库的顺序一致（落库顺序会影响
    // 自增 id，进而影响渲染时同 sort_no 的兜底排序）。
    let mut names: Vec<&String> = app.balancers.keys().collect();
    names.sort();
    let mut balancers = Vec::with_capacity(names.len());
    for name in names {
        let config = &app.balancers[name];
        balancers.push(PlannedBalancer {
            name: name.clone(),
            config_json: to_json(config)?,
        });
    }

    Ok(ImportPlan {
        extra_toml,
        ops_json,
        static_json,
        upstream_error_json,
        listeners,
        balancers,
        warnings,
    })
}

/// # 往返比对
///
/// 拿「原始 TOML 解析出的 `AppConfig`」与「导入计划模拟渲染出的 `AppConfig`」
/// 做语义签名比对，另外检查顶层段有没有丢。
///
/// ## 参数
/// - `original`：原始 TOML 解析出的配置
/// - `original_raw`：原始 TOML 的顶层表（用来查 `[pingora-conf]` 与顶层键集合）
/// - `rendered`：用导入计划渲染出的结果
///
/// ## 返回值
/// 差异列表；**空**表示往返无损，可以落库
///
/// ## 错误
/// 签名序列化失败（框架 bug）
pub fn verify(
    original: &AppConfig,
    original_raw: &toml::Table,
    rendered: &RenderedConfig,
) -> Result<Vec<String>, RenderError> {
    let mut diffs = compare(original, &rendered.app_config)?;

    let Ok(rendered_raw) = toml::from_str::<toml::Table>(&rendered.toml) else {
        diffs.push("渲染结果无法解析成 TOML（渲染器自检失败）".to_string());
        return Ok(diffs);
    };

    let before: BTreeSet<&String> = original_raw.keys().collect();
    let after: BTreeSet<&String> = rendered_raw.keys().collect();
    for key in before.difference(&after) {
        diffs.push(format!("顶层段 [{key}] 在渲染结果里丢了"));
    }

    // `[pingora-conf]` 走 `extra_toml` 原样带回，逐值比一次就够——它是整段透传，
    // 没有「拆开再拼回去」的环节，所以这里可以直接比 `toml::Value`
    if let (Some(before), Some(after)) = (
        original_raw.get("pingora-conf"),
        rendered_raw.get("pingora-conf"),
    ) {
        if before != after {
            diffs.push("顶层段 [pingora-conf] 与导入前不一致".to_string());
        }
    }

    Ok(diffs)
}

/// # 比对两份配置
///
/// 语义比对：逐部件序列化后比较，与 [`verify`] 用的是同一套签名。
/// 导入完成后拿它跟 KV 里的那份比，回答「库里现在这份跟线上跑的一样吗」。
///
/// ## 参数
/// - `before`：基准配置（通常是 KV 里读出来的那份）
/// - `after`：要比的配置（通常是导入后从库里渲染出来的那份）
///
/// ## 返回值
/// 差异列表；空表示语义等价
///
/// ## 错误
/// 签名序列化失败（框架 bug）
pub fn compare(before: &AppConfig, after: &AppConfig) -> Result<Vec<String>, RenderError> {
    Ok(diff_signature(&signature(before)?, &signature(after)?))
}

/// # 语义签名
///
/// 把配置拆成「部件 → 规范化字符串」的映射，用来比对两份配置是否等价。
/// 每个部件单独序列化，所以差异能定位到「第几个监听器的第几条路由」，
/// 而不是笼统的「配置不一样」。
///
/// ## 参数
/// - `app`：要签名的配置
///
/// ## 返回值
/// 键是部件路径，值是 `serde_json` 序列化结果
///
/// ## 为什么用 JSON 不用 TOML
///
/// TOML 没有 `null`，`Option::None` 在 TOML 序列化里会被**省略**——两个本来
/// 不同的配置（`tls = None` 与 `tls = Some(默认值)`）可能序列化成同一个字符串。
/// JSON 保留 `null`，能区分开。
pub fn signature(app: &AppConfig) -> Result<BTreeMap<String, String>, RenderError> {
    let mut parts = BTreeMap::new();

    for (index, listener) in app.listeners.iter().enumerate() {
        parts.insert(
            format!("listeners[{index}].addrs"),
            to_json(&listener.addrs)?,
        );
        for (route_index, route) in listener.routes.iter().enumerate() {
            parts.insert(
                format!("listeners[{index}].routes[{route_index}].matcher"),
                to_json(&route.matcher)?,
            );
            parts.insert(
                format!("listeners[{index}].routes[{route_index}].to"),
                to_json(&route.to)?,
            );
            parts.insert(
                format!("listeners[{index}].routes[{route_index}].log"),
                to_json(&route.log)?,
            );
        }
    }

    for (index, listener) in app.tcp_listeners.iter().enumerate() {
        parts.insert(
            format!("tcp-listeners[{index}].addrs"),
            to_json(&listener.addrs)?,
        );
        for (route_index, route) in listener.routes.iter().enumerate() {
            parts.insert(
                format!("tcp-listeners[{index}].routes[{route_index}].matcher"),
                to_json(&route.matcher)?,
            );
            parts.insert(
                format!("tcp-listeners[{index}].routes[{route_index}].to"),
                to_json(&route.to)?,
            );
        }
    }

    for (name, balancer) in &app.balancers {
        parts.insert(format!("balancers[{name}]"), to_json(balancer)?);
    }

    parts.insert("static".to_string(), to_json(&app.r#static)?);
    parts.insert(
        "upstream-error".to_string(),
        to_json(&app.upstream_error)?,
    );
    parts.insert("ops".to_string(), to_json(&app.ops)?);

    Ok(parts)
}

/// # 比对两份签名
///
/// ## 参数
/// - `before`：原始配置的签名
/// - `after`：渲染结果的签名
///
/// ## 返回值
/// 人话差异列表，最多 [`MAX_DIFF_ITEMS`] 条（再多就没人看了），
/// 超出部分汇总成一句
fn diff_signature(
    before: &BTreeMap<String, String>,
    after: &BTreeMap<String, String>,
) -> Vec<String> {
    let mut diffs = Vec::new();
    let mut overflow = 0usize;

    for (key, value) in before {
        match after.get(key) {
            None => push(&mut diffs, &mut overflow, format!("{key} 在导入结果里消失了")),
            Some(other) if other != value => push(
                &mut diffs,
                &mut overflow,
                format!("{key} 的内容不同：导入前 {value}，导入后 {other}"),
            ),
            Some(_) => {}
        }
    }
    for key in after.keys() {
        if !before.contains_key(key) {
            push(
                &mut diffs,
                &mut overflow,
                format!("{key} 是导入结果里多出来的"),
            );
        }
    }

    if overflow > 0 {
        diffs.push(format!("……另有 {overflow} 处差异未列出"));
    }
    diffs
}

/// 追加一条差异，超过上限就只计数
fn push(diffs: &mut Vec<String>, overflow: &mut usize, item: String) {
    if diffs.len() < MAX_DIFF_ITEMS {
        diffs.push(item);
    } else {
        *overflow += 1;
    }
}

/// HTTP 路由 → 计划
fn plan_http_routes(routes: &[RouteConfig]) -> Result<Vec<PlannedRoute>, RenderError> {
    let mut planned = Vec::with_capacity(routes.len());
    for (index, route) in routes.iter().enumerate() {
        planned.push(PlannedRoute {
            sort_no: index as i32 + 1,
            name: describe_matcher(&route.matcher),
            matcher_json: to_json(&route.matcher)?,
            to_json: to_json(&route.to)?,
            log_json: Some(to_json(&route.log)?),
        });
    }
    Ok(planned)
}

/// TCP 路由 → 计划
///
/// TCP 层看不到 HTTP 头，`matcher` 只有一个 `Default` 变体，所以这里写死
/// `{"type":"Default"}`。**上游若新增 TCP 匹配器，这里必须跟着改**——
/// 否则新匹配器导入后会静默退化成「所有连接都匹配」。
fn plan_tcp_routes(routes: &[TcpRouteConfig]) -> Result<Vec<PlannedRoute>, RenderError> {
    let mut planned = Vec::with_capacity(routes.len());
    for (index, route) in routes.iter().enumerate() {
        planned.push(PlannedRoute {
            sort_no: index as i32 + 1,
            name: format!("TCP 默认 #{}", index + 1),
            matcher_json: to_json(&route.matcher)?,
            to_json: to_json(&route.to)?,
            log_json: None,
        });
    }
    Ok(planned)
}

/// # 由匹配条件推导一个展示名
///
/// TOML 里路由没有名字，但 `uiam_gateway_route.name` 非空。名字要能让人在
/// 列表里一眼认出是哪条，所以用「形状 + 关键值」而不是 `路由 1 / 路由 2`。
///
/// ## 参数
/// - `matcher`：路由匹配条件
///
/// ## 返回值
/// 形如 `前缀 /adm`、`主机 api.example.com`、`正则 ^/v[0-9]+/`
fn describe_matcher(matcher: &RouteMatcherConfig) -> String {
    /// 名字列宽有限，超长截断
    const MAX_LEN: usize = 80;

    let text = match matcher {
        RouteMatcherConfig::Host { addr } => format!("主机 {addr}"),
        RouteMatcherConfig::Exact { addr, urn } => {
            format!("精确 {}{}", urns(urn), host_suffix(addr.as_deref()))
        }
        RouteMatcherConfig::Prefix { addr, urn } => {
            format!("前缀 {}{}", urns(urn), host_suffix(addr.as_deref()))
        }
        RouteMatcherConfig::Regex {
            addr,
            method,
            regex,
        } => {
            let method = method
                .as_deref()
                .map(|method| format!("{method} "))
                .unwrap_or_default();
            format!("正则 {method}{regex}{}", host_suffix(addr.as_deref()))
        }
        RouteMatcherConfig::Service { svc_name } => format!("服务 {}", svc_name.join(", ")),
    };

    if text.chars().count() > MAX_LEN {
        let truncated: String = text.chars().take(MAX_LEN).collect();
        format!("{truncated}…")
    } else {
        text
    }
}

/// 把 URN 列表拼成一行
fn urns(urn: &[wheel_rs::urn_utils::Urn]) -> String {
    urn.iter()
        .map(|urn| urn.to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

/// 匹配器带了 host 时补一句
fn host_suffix(addr: Option<&str>) -> String {
    match addr {
        Some(addr) => format!(" @{addr}"),
        None => String::new(),
    }
}

/// 序列化成 JSON，失败时带上字段上下文
fn to_json<T: Serialize>(value: &T) -> Result<String, RenderError> {
    Ok(serde_json::to_string(value)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::render;

    /// 一份「像线上那样」的配置：监听器带 TLS 之外的全部常见字段
    const SAMPLE: &str = r#"
[ops]
health-path = "/health"
metrics-path = "/metrics"
addrs = ["0.0.0.0:9090"]

[balancers.adm-lb]
type = "Swarm"
service-name = "adm_svr"
port = 8080

[balancers.static-lb]
type = "Array"
backends = ["10.0.0.1:8080", "10.0.0.2:8080"]

[[listeners]]
addrs = [{ addr = "0.0.0.0:80" }]

[[listeners.routes]]
matcher = { type = "Prefix", urn = ["/adm"] }
to = { type = "LoadBalancer", name = "adm-lb" }

[[listeners.routes]]
matcher = { type = "Exact", urn = ["/health"] }
to = { type = "Static" }

[[listeners.routes]]
matcher = { type = "Regex", regex = "^/v[0-9]+/" }
to = { type = "Host", addr = "10.0.0.9:8080", uri = { type = "StripPrefix" } }

[[tcp-listeners]]
addrs = [{ addr = "0.0.0.0:6379" }]

[[tcp-listeners.routes]]
to = { type = "Host", addr = "10.0.0.5:6379" }

[static]
root-dir = "static"
"#;

    fn gateway_vo() -> UiamGatewayVo {
        UiamGatewayVo {
            id: 1u64.into(),
            code: "svr00".to_string(),
            name: "网关00".to_string(),
            consul_key: "gatex-rs-svr00.toml".to_string(),
            extra_toml: None,
            ops_json: None,
            static_json: None,
            upstream_error_json: None,
            remark: None,
            enabled: true,
            creater_id: 1u64.into(),
            create_ms: 0u64.into(),
            updater_id: 1u64.into(),
            update_ms: 0u64.into(),
        }
    }

    /// 把 plan 灌进 gateway 的 JSON 列，模拟「落库之后再渲染」的形态
    fn plan_to_gateway(plan: &ImportPlan) -> UiamGatewayVo {
        UiamGatewayVo {
            extra_toml: plan.extra_toml.clone(),
            ops_json: plan.ops_json.clone(),
            static_json: plan.static_json.clone(),
            upstream_error_json: plan.upstream_error_json.clone(),
            ..gateway_vo()
        }
    }

    #[test]
    fn 拆解后模拟渲染能原样还原() {
        let plan = plan_from_toml(SAMPLE).expect("应当解析成功");
        assert_eq!(plan.http_listener_count(), 1);
        assert_eq!(plan.tcp_listener_count(), 1);
        assert_eq!(plan.http_route_count(), 3);
        assert_eq!(plan.tcp_route_count(), 1);
        assert_eq!(plan.balancers.len(), 2);
        assert!(plan.ops_json.is_some());
        assert!(plan.static_json.is_some());
        assert!(plan.extra_toml.is_none(), "这份 TOML 没有 pingora-conf");

        let original: AppConfig = toml::from_str(SAMPLE).unwrap();
        let original_raw: toml::Table = toml::from_str(SAMPLE).unwrap();
        let rendered = render(&plan.to_render_input(plan_to_gateway(&plan)), None)
            .expect("模拟渲染应当成功");

        let diffs = verify(&original, &original_raw, &rendered).expect("比对");
        assert!(diffs.is_empty(), "往返必须无损：{diffs:#?}");
    }

    #[test]
    fn pingora_conf_进附加_toml_且能带回() {
        let text = format!("[pingora-conf]\nthreads = 4\n{SAMPLE}");
        let plan = plan_from_toml(&text).expect("应当解析成功");
        let extra = plan.extra_toml.clone().expect("pingora-conf 必须进附加 TOML");
        assert!(extra.contains("pingora-conf"), "{extra}");
        assert!(
            plan.warnings.iter().any(|w| w.contains("pingora-conf")),
            "要告诉用户这段只能进附加 TOML：{:?}",
            plan.warnings
        );

        let original: AppConfig = toml::from_str(&text).unwrap();
        let original_raw: toml::Table = toml::from_str(&text).unwrap();
        let rendered = render(&plan.to_render_input(plan_to_gateway(&plan)), None)
            .expect("模拟渲染应当成功");

        assert_eq!(rendered.app_config.pingora_conf.0.threads, 4);
        let diffs = verify(&original, &original_raw, &rendered).expect("比对");
        assert!(diffs.is_empty(), "{diffs:#?}");
    }

    #[test]
    fn 没有_ops_段时不写_ops_json() {
        let text = SAMPLE.replace(
            "[ops]\nhealth-path = \"/health\"\nmetrics-path = \"/metrics\"\naddrs = [\"0.0.0.0:9090\"]\n",
            "",
        );
        let plan = plan_from_toml(&text).expect("应当解析成功");
        assert!(plan.ops_json.is_none(), "原 TOML 没有 [ops] 就不该写");
    }

    #[test]
    fn 路由名由匹配条件推导() {
        let plan = plan_from_toml(SAMPLE).expect("应当解析成功");
        let names: Vec<&str> = plan.listeners[0]
            .routes
            .iter()
            .map(|route| route.name.as_str())
            .collect();
        assert_eq!(names, vec!["前缀 /adm", "精确 /health", "正则 ^/v[0-9]+/"]);
        assert_eq!(plan.listeners[1].routes[0].name, "TCP 默认 #1");
    }

    #[test]
    fn 语法错误被拒绝() {
        let err = plan_from_toml("[[listeners]\n").expect_err("必须拒绝");
        assert!(
            matches!(err, RenderError::SourceToml { .. }),
            "应归到源 TOML 错误：{err:?}"
        );
    }

    #[test]
    fn 引用了不存在的负载均衡器会在模拟渲染时被拦下() {
        let text = SAMPLE.replace(
            "to = { type = \"LoadBalancer\", name = \"adm-lb\" }",
            "to = { type = \"LoadBalancer\", name = \"not-exist\" }",
        );
        let plan = plan_from_toml(&text).expect("解析阶段不校验引用");
        let err = render(&plan.to_render_input(plan_to_gateway(&plan)), None)
            .expect_err("模拟渲染必须拦住");
        assert!(
            matches!(err, RenderError::Validate(ref reason) if reason.contains("not-exist")),
            "{err:?}"
        );
    }

    #[test]
    fn 往返比对能发现被改坏的签名() {
        let plan = plan_from_toml(SAMPLE).expect("应当解析成功");
        let original: AppConfig = toml::from_str(SAMPLE).unwrap();
        let original_raw: toml::Table = toml::from_str(SAMPLE).unwrap();
        let rendered = render(&plan.to_render_input(plan_to_gateway(&plan)), None)
            .expect("模拟渲染应当成功");

        // 故意从原始配置里删一条路由：签名必然对不上，闸门必须报出来
        let mut broken = original.clone();
        broken.listeners[0].routes.pop();
        let diffs = verify(&broken, &original_raw, &rendered).expect("比对");
        assert!(!diffs.is_empty(), "少一条路由必须被发现");
    }
}
