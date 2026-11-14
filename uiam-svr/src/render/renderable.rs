//! # 渲染输入与可序列化镜像
//!
//! 数据库里存的是「结构化列 + JSON 文本列」的混合形态，gatex 要的是
//! `AppConfig`。这一层负责把前者翻译成后者，并保留一个可以序列化的镜像
//! [`RenderableAppConfig`]。
//!
//! ## 为什么不直接序列化 `AppConfig`
//!
//! `gatex_svr::config::AppConfig` 只派生了 `Deserialize`——它是「读配置」用的，
//! 从来没打算被写回去。给它补 `Serialize` 会把「配置的书写格式」变成 gatex 的
//! 公开契约（改一个字段顺序就影响所有管理面），所以这里另立一个镜像结构，
//! 字段名与 serde 属性逐一对齐，**只多不少**。
//!
//! 镜像结构是「单向」的：只用来 `toml::to_string_pretty`，读回来一律走
//! `toml::from_str::<AppConfig>`。这样即便两边哪天有细微不一致，也会在
//! 自检那一步立刻暴露，而不是悄悄产出一份网关读不懂的 TOML。

use crate::render::RenderError;
use gatex_svr::config::{
    BalancerConfig, ListenerAddrConfig, ListenerConfig, LogConfig, OpsConfig, RouteConfig,
    StaticConfig, TcpListenerConfig, TcpRouteConfig, TcpRouteMatcherConfig, UpstreamErrorConfig,
};
use serde::Serialize;
use std::collections::BTreeMap;
use uiam_api::dic::ListenerKind;
use uiam_api::vo::{
    UiamGatewayBalancerVo, UiamGatewayListenerVo, UiamGatewayRouteVo, UiamGatewayVo,
};

/// # 渲染输入
///
/// 一个网关实例的整棵子树，**已经按实例过滤好**。渲染器不查库：它只做纯函数
/// 变换，这样可以在测试里直接构造数据，也不会因为读库时机不同渲染出不同结果。
#[derive(Debug, Clone)]
pub struct RenderInput {
    /// 实例本身（提供 `extra_toml` / `ops_json` / `static_json` / `upstream_error_json`）
    pub gateway: UiamGatewayVo,
    /// 该实例下的全部监听器（含停用的，由渲染器按 `enabled` 过滤）
    pub listeners: Vec<UiamGatewayListenerVo>,
    /// 该实例下的全部路由（含停用的）。可以混着不同监听器的路由，
    /// 渲染器按 `listener_id` 分组；不属于本批监听器的路由会被忽略
    pub routes: Vec<UiamGatewayRouteVo>,
    /// 该实例下的全部负载均衡器（含停用的）
    pub balancers: Vec<UiamGatewayBalancerVo>,
}

/// # 渲染中间产物
///
/// `app` 是待序列化的镜像；`warnings` 是「能发布但值得提醒」的问题，
/// 与试装配给出的告警合并后一起返回给调用方。
#[derive(Debug, Clone)]
pub struct PreparedConfig {
    /// 可序列化的配置镜像
    pub app: RenderableAppConfig,
    /// 渲染阶段产生的告警
    pub warnings: Vec<String>,
}

/// # 配置镜像（只用于序列化成 TOML）
///
/// 与 `gatex_svr::config::AppConfig` 的字段一一对应，区别只有两处：
///
/// 1. `balancers` 用 `BTreeMap` 而不是 `HashMap`——顺序必须确定，否则同一份数据
///    每次渲染出的字节流不同，`checksum` 就不稳定，「内容没变不重复推」失效。
/// 2. 可选的顶层段用 `Option` + `skip_serializing_if`——库里的列是 `null` 时
///    不写进 TOML，让 gatex 用它自己的默认值。写死默认值等于把 gatex 的默认值
///    冻结在 uiam 里，上游改了默认值这边不会跟。
///
/// `pingora-conf` 不在这里：它无法结构化，只能整段放在实例的 `extra_toml` 里。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub struct RenderableAppConfig {
    /// HTTP 监听器
    pub listeners: Vec<ListenerConfig>,
    /// TCP 监听器
    pub tcp_listeners: Vec<TcpListenerConfig>,
    /// 负载均衡器（按名字排序，保证渲染稳定）
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub balancers: BTreeMap<String, BalancerConfig>,
    /// 静态资源
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#static: Option<StaticConfig>,
    /// 上游错误策略
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_error: Option<UpstreamErrorConfig>,
    /// 运维端点
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ops: Option<OpsConfig>,
}

impl RenderInput {
    /// # 把数据库形态翻译成配置镜像
    ///
    /// ## 参数
    /// 无（读 `self`）
    ///
    /// ## 返回值
    /// [`PreparedConfig`]：镜像 + 渲染期告警
    ///
    /// ## 错误
    /// - [`RenderError::InvalidJson`]：某个 JSON 列反序列化失败，错误里带实体名与行 id
    ///
    /// ## 行为
    /// - 停用的监听器 / 路由 / 负载均衡器不参与渲染，并各产生一条告警
    /// - 监听器按 `(sort_no, id)` 排序，路由同理——顺序即语义，且必须确定
    /// - TCP 监听器的路由忽略 `matcher_json`：`TcpRouteMatcherConfig` 只有一个
    ///   `Default` 变体，没有可选项。**上游若新增 TCP 匹配器，这里必须跟着改**
    pub fn to_renderable(&self) -> Result<PreparedConfig, RenderError> {
        let mut warnings = Vec::new();

        // ---- 监听器：过滤停用 + 排序 ----
        let mut listeners: Vec<&UiamGatewayListenerVo> = Vec::new();
        for listener in &self.listeners {
            if listener.enabled {
                listeners.push(listener);
            } else {
                warnings.push(format!(
                    "监听器 #{}（{}）已停用，不参与渲染",
                    listener.id,
                    kind_label(listener.kind)
                ));
            }
        }
        listeners.sort_by_key(|l| (l.sort_no, l.id.0));

        // ---- 路由：按监听器分组，组内过滤停用 + 排序 ----
        let mut routes_by_listener: BTreeMap<u64, Vec<&UiamGatewayRouteVo>> = BTreeMap::new();
        for route in &self.routes {
            if !route.enabled {
                warnings.push(format!("路由 #{}（{}）已停用，不参与渲染", route.id, route.name));
                continue;
            }
            routes_by_listener
                .entry(route.listener_id.0)
                .or_default()
                .push(route);
        }
        for routes in routes_by_listener.values_mut() {
            routes.sort_by_key(|r| (r.sort_no, r.id.0));
        }

        // ---- 逐个监听器装配 ----
        let mut http_listeners = Vec::new();
        let mut tcp_listeners = Vec::new();
        for listener in listeners {
            let mut default_routes = 0usize;
            let addrs: Vec<ListenerAddrConfig> = parse_json(
                &listener.addrs_json,
                "listener",
                listener.id.0,
                "addrs_json",
            )?;
            let routes = routes_by_listener
                .remove(&listener.id.0)
                .unwrap_or_default();

            match listener.kind {
                ListenerKind::Http => {
                    let mut http_routes = Vec::with_capacity(routes.len());
                    for route in routes {
                        http_routes.push(RouteConfig {
                            matcher: parse_json(
                                &route.matcher_json,
                                "route",
                                route.id.0,
                                "matcher_json",
                            )?,
                            to: parse_json(&route.to_json, "route", route.id.0, "to_json")?,
                            log: parse_opt_json::<LogConfig>(
                                &route.log_json,
                                "route",
                                route.id.0,
                                "log_json",
                            )?
                            .unwrap_or_default(),
                        });
                    }
                    http_listeners.push(ListenerConfig {
                        addrs,
                        routes: http_routes,
                    });
                }
                ListenerKind::Tcp => {
                    let mut tcp_routes = Vec::with_capacity(routes.len());
                    for route in routes {
                        let matcher = tcp_matcher(route, &mut warnings);
                        if matches!(matcher, TcpRouteMatcherConfig::Default) {
                            default_routes += 1;
                            if default_routes > 1 {
                                warnings.push(format!(
                                    "TCP 监听器#{} 下有多条 Default 匹配的路由（含 #{}），\
                                     只有第一条会生效——TCP 只能按连接顺序匹配，无法按内容分流",
                                    listener.id, route.id
                                ));
                            }
                        }
                        tcp_routes.push(TcpRouteConfig {
                            matcher,
                            to: parse_json(&route.to_json, "route", route.id.0, "to_json")?,
                        });
                    }
                    tcp_listeners.push(TcpListenerConfig {
                        addrs,
                        routes: tcp_routes,
                    });
                }
            }
        }

        // ---- 负载均衡器：实例级全局 map ----
        let mut balancers = BTreeMap::new();
        for balancer in &self.balancers {
            if !balancer.enabled {
                warnings.push(format!(
                    "负载均衡器 {}（#{}）已停用，不参与渲染",
                    balancer.name, balancer.id
                ));
                continue;
            }
            let config: BalancerConfig =
                parse_json(&balancer.config_json, "balancer", balancer.id.0, "config_json")?;
            if balancers.insert(balancer.name.clone(), config).is_some() {
                // 唯一约束 `(gateway_id, name)` 应该已经拦住，走到这里说明数据被绕过写进来了
                warnings.push(format!(
                    "负载均衡器 {} 出现重名，后一条覆盖了前一条",
                    balancer.name
                ));
            }
        }

        // ---- 实例级可选段 ----
        let ops: Option<OpsConfig> =
            parse_opt_json(&self.gateway.ops_json, "gateway", self.gateway.id.0, "ops_json")?;
        let r#static: Option<StaticConfig> = parse_opt_json(
            &self.gateway.static_json,
            "gateway",
            self.gateway.id.0,
            "static_json",
        )?;
        let upstream_error: Option<UpstreamErrorConfig> = parse_opt_json(
            &self.gateway.upstream_error_json,
            "gateway",
            self.gateway.id.0,
            "upstream_error_json",
        )?;

        Ok(PreparedConfig {
            app: RenderableAppConfig {
                listeners: http_listeners,
                tcp_listeners,
                balancers,
                r#static,
                upstream_error,
                ops,
            },
            warnings,
        })
    }
}

/// # 解析 TCP 路由的匹配器
///
/// `TcpRouteMatcherConfig` 只有一个 `Default` 变体——TCP 层看不到 HTTP 头，
/// 没有可匹配的内容，只能在连接进来时按顺序试。所以 `matcher_json` 实际上
/// 没有可选项。
///
/// ## 为什么还要解析一次
///
/// 前端复用了同一套路由表单，用户完全可能在 TCP 路由上填一个 `Regex`。
/// 早期实现直接取默认值，结果是**填了正则被静默变成 Default**，界面上看着
/// 配了、实际没生效。现在改成：能解析就用，解析不了就告警后降级，
/// 让用户看见「你配的这个在 TCP 上无效」。
///
/// 空串、`{}`、`null` 视为「没配」，不告警——这是表单留空的正常形态。
fn tcp_matcher(
    route: &UiamGatewayRouteVo,
    warnings: &mut Vec<String>,
) -> TcpRouteMatcherConfig {
    let raw = route.matcher_json.trim();
    if raw.is_empty() || raw == "{}" || raw == "null" {
        return TcpRouteMatcherConfig::default();
    }
    match serde_json::from_str::<TcpRouteMatcherConfig>(raw) {
        Ok(matcher) => matcher,
        Err(err) => {
            warnings.push(format!(
                "路由#{}（{}）的匹配条件在 TCP 监听器上无效（{err}），已按 Default 处理",
                route.id, route.name
            ));
            TcpRouteMatcherConfig::default()
        }
    }
}

/// 反序列化一个必填的 JSON 列
fn parse_json<T: serde::de::DeserializeOwned>(
    raw: &str,
    entity: &'static str,
    id: u64,
    column: &'static str,
) -> Result<T, RenderError> {
    serde_json::from_str(raw).map_err(|source| RenderError::InvalidJson {
        entity,
        id,
        column,
        source,
    })
}

/// 反序列化一个可选的 JSON 列
///
/// 空串与全空白都当作「没配置」。库里理论上只会有 `NULL`，但手写 SQL 或
/// 前端留空都可能塞进 `''`，一律按未配置处理，避免因为一个空串让整次发布失败。
fn parse_opt_json<T: serde::de::DeserializeOwned>(
    raw: &Option<String>,
    entity: &'static str,
    id: u64,
    column: &'static str,
) -> Result<Option<T>, RenderError> {
    match raw.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) => parse_json(text, entity, id, column).map(Some),
    }
}

/// 监听器类型的中文标签，只用于告警文本
fn kind_label(kind: ListenerKind) -> &'static str {
    match kind {
        ListenerKind::Http => "HTTP",
        ListenerKind::Tcp => "TCP",
    }
}
