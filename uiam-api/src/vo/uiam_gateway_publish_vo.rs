use robotech::api::U64;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// # 发布结果
///
/// 一次发布（或回滚）的完整结论。前端拿它就能把「发了没发、发的是哪一版、
/// 要不要重启、有没有隐患」全部说清楚，不需要再查一次列表。
///
/// ## `pushed` 与 `skipped` 是两件事
///
/// - `skipped = true`：内容与当前线上版本逐字节相同，**没有**产生新版本，
///   也没有写 KV。此时 `release_id` / `version` 是那个「已经在线上」的版本。
/// - `pushed = false` 且 `skipped = false`：不该出现——落库后推送失败会直接报错，
///   不会返回成功结果。真出现了说明回填失败，看 `warnings`。
///
/// ## 发布 ≠ 生效
///
/// `pushed = true` 只代表 Consul KV 写成功。网关进程什么时候读到、要不要重启，
/// 由 `structuralChange` 和网关自身的热更新机制决定，管理面不做二次确认。
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UiamGatewayPublishVo {
    /// 网关实例ID
    pub gateway_id: U64,
    /// 发布记录ID
    ///
    /// `skipped = true` 时是「线上正在跑的那一版」的记录 ID。
    pub release_id: U64,
    /// 版本号
    pub version: i32,
    /// 本次内容的摘要（`sha256` 十六进制）
    pub checksum: String,
    /// 是否真的写了 Consul KV
    pub pushed: bool,
    /// 内容与线上版本一致，已跳过
    pub skipped: bool,
    /// 实际写入的 Consul KV key
    ///
    /// **含环境前缀的完整 key**（如 `dev/gatex-rs-svr.toml`），不是库里存的
    /// `consul_key`。前端要核对「配到哪个键上了」时，用这个值直接去 Consul 里查。
    pub consul_key: String,
    /// Consul 返回的 `ModifyIndex`
    ///
    /// 没写 KV、或写后回读失败时为空。可以拿它跟网关侧读到的索引对比，
    /// 确认新配置已被感知。
    ///
    /// ## 为什么是回读来的
    ///
    /// Consul 的 KV PUT **不返回** `X-Consul-Index`，只有 GET 才有。所以发布
    /// 在写完之后会回读一次：既取到这个索引，也顺便确认「读回来的就是刚写的
    /// 那份内容」——不一致会在 `warnings` 里说出来。
    pub modify_index: Option<u64>,
    /// 结构性变更说明；`Some` 表示要重启网关才生效
    pub structural_change: Option<String>,
    /// 可发布但值得提醒的问题
    ///
    /// 包括渲染期告警（停用记录被跳过、`extra_toml` 被忽略的键、TCP 匹配器无效…）、
    /// KV 现状与数据库不一致、以及「已推送但回填失败」。
    pub warnings: Vec<String>,
}
