use robotech::api::U64;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// # 导入结果
///
/// 一次导入（或导入预演）的完整结论。前端拿它就能回答三个问题：
/// 拆出来多少东西、跟线上 KV 里的那份是不是一致、有没有需要人看一眼的地方。
///
/// ## `kvMatches` 是「接管」的安全阀
///
/// 导入完成后从库里重新渲染一遍，再跟 `consulKey` 指向的那份 KV 内容做语义
/// 比对：
///
/// - `true`：库里现在的配置与线上正在跑的一致 → 下次发布不会改变网关行为
/// - `false`：不一致，看 `kvDiff` 逐条对——**这时候发布就是改线上配置**
/// - `null`：没比对（key 不存在、Consul 读不到，或本次是预演但还没定 key）
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UiamGatewayImportVo {
    /// 网关实例ID
    pub gateway_id: U64,

    /// 本次是否只做了预演（没有写库）
    pub dry_run: bool,

    /// 是否真的落库了
    ///
    /// 与 `dryRun` 互为反义，但两个都返回：前端不必自己取反，
    /// 也不会因为将来多出「部分落库」的形态而语义错乱。
    pub applied: bool,

    /// HTTP 监听器数量
    pub http_listeners: u32,
    /// TCP 监听器数量
    pub tcp_listeners: u32,
    /// HTTP 路由数量
    pub http_routes: u32,
    /// TCP 路由数量
    pub tcp_routes: u32,
    /// 负载均衡器数量
    pub balancers: u32,

    /// 该实例的 Consul KV key（裸 key，不含环境前缀）
    ///
    /// 传了 `consulKey` 时是改完之后的那个值。
    pub consul_key: String,

    /// 导入后渲染出的 TOML 的 `sha256`
    ///
    /// 与 `publish` 返回的 `checksum` 同一套算法，可以直接比。
    pub checksum: String,

    /// 导入后渲染出的完整 TOML
    ///
    /// 预演时是「假如落库，渲染出来会是这样」；正式导入时是「从库里读出来
    /// 渲染的结果」。两种情况下都是发布会写进 KV 的那份字节流。
    pub toml: String,

    /// 有没有真的读到 KV 并完成比对
    pub kv_checked: bool,

    /// 库里的配置与 KV 里的内容是否语义一致
    pub kv_matches: Option<bool>,

    /// 不一致时的逐条差异
    pub kv_diff: Vec<String>,

    /// 可导入但值得提醒的问题
    ///
    /// 包括：哪些顶层段只能进「附加 TOML」（`[pingora-conf]` 等）、
    /// 这份 TOML 里没有监听器、以及落库后复验发现的不一致。
    pub warnings: Vec<String>,
}
