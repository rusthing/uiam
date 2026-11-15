use serde::Deserialize;
use utoipa::ToSchema;

/// # 导入现有 TOML 请求
///
/// 把一个已经在跑的网关配置（通常是 Consul KV 里那一份）拆成结构化数据，
/// 写进库里对应的监听器 / 路由 / 负载均衡器 / 实例级 JSON 列。
///
/// ## 为什么要 `dryRun`
///
/// 导入是「反向解析 + 整段替换」，出错时不会报错——库里多一条少一条路由都
/// 能存进去，直到下次发布把错的推上网关才炸。所以默认**不落库**：
/// 先跑一遍，看 `kvMatches` 是不是 `true`、`warnings` 有没有意外，确认之后
/// 再带 `dryRun: false` 来真的。
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UiamGatewayImportDto {
    /// 完整的网关配置 TOML 文本
    ///
    /// 必须是 gatex 能直接吃下的那一份（含 `[listeners]` / `[balancers]` 等），
    /// 不是片段。解析失败会返回 400，`msg` 里带出错的行列号。
    pub toml: String,

    /// 同时把实例的 `consul_key` 改成这个值
    ///
    /// 用于「接管线上网关」：线上真正被读的是 `gatex-rs-svr00.toml`，而种子数据
    /// 里的 `consul_key` 可能是别的名字。不传则保持原值。
    ///
    /// 校验规则与新增实例一致：非空、不带 `/`（KV 前缀由部署配置决定）。
    #[serde(default)]
    pub consul_key: Option<String>,

    /// 只校验、不落库
    ///
    /// 默认 `false`。注意：`false` 时**整段替换**该实例现有的监听器、路由、
    /// 负载均衡器——这是导入的语义（让库里的数据等于这份 TOML），不是合并。
    #[serde(default)]
    pub dry_run: bool,
}
