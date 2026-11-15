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

/// # 线上配置的原文
///
/// 导入弹窗的第一步：把网关**正在读**的那份 TOML 从 Consul 拉出来，填进
/// 编辑框，用户确认后再走预演 / 导入。
///
/// 没有这个接口的话，接管线上网关就得先 ssh 上去 `curl` 一遍 KV——那一步
/// 既容易抄错（少一个换行、多了响应头），也没法在界面上留痕。
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UiamGatewayImportSourceVo {
    /// 网关实例ID
    pub gateway_id: U64,

    /// 该实例的 Consul KV key（裸 key，不含环境前缀）
    pub consul_key: String,

    /// 实际请求的完整 key（含环境前缀），排错时看这个
    pub full_key: String,

    /// KV 里到底有没有这个 key
    ///
    /// `false` 时 `content` 是空串，`note` 里说明原因。这不是错误：
    /// 从没发布过、或者 key 被删了，都属于「读不到但服务本身没问题」。
    pub found: bool,

    /// TOML 原文
    pub content: String,

    /// Consul 的 `ModifyIndex`，`found = false` 时为 `null`
    ///
    /// 同一个 key 被写过就会变。用户拿它判断「我看到的这份是不是刚被人改过」。
    pub modify_index: Option<u64>,

    /// `found = false` 时的说明
    pub note: Option<String>,
}
