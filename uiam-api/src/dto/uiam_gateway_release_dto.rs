use robotech::macros::crud_dto;

/// # 网关发布版本
///
/// 一条 release = 一次「渲染 + 推送」的完整结果。`content` 存渲染出的整份 TOML，
/// 是**唯一**存渲染结果的地方。
///
/// ## 回滚为什么不重新渲染
///
/// 渲染依赖的配置行（listener / route / balancer）在两次发布之间可能已经改过。
/// 重渲染得到的是「现在的配置」，不是「当初发出去的那一份」——那不叫回滚，叫重新发布。
/// 真正的回滚是把历史 `content` 原样 PUT 一次，所以 `content` 必须完整落库。
///
/// ## `checksum`
///
/// `sha256(content)` 的十六进制串。两个用途：
/// 1. 内容没变就不重复推（省一次 Consul 写和一轮网关 reload）
/// 2. 界面上「这版和上一版有没有区别」只需要比摘要，不用把两份 TOML 都拉下来
///
/// ## `pushed` 与 `pushed_ms`
///
/// 发布 ≠ 生效。`pushed = true` 只代表 Consul KV 写成功，网关进程是否已经
/// reload 是另一回事（由 `release` 之外的机制确认）。
///
/// ## 关于 `content` 会出现在列表接口里
///
/// `#[crud_dto]` / `#[vo]` 不支持字段级投影，所以 `content` 会跟着列表/分页一起返回。
/// 一份网关配置通常 3~20 KB，历史列表页会被放大。这里先按「字段完整优先」处理——
/// 后续补一个只返回元数据的摘要接口是**加字段**，不破坏兼容；反过来先砍掉
/// 字段再补就是破坏性变更。
#[crud_dto]
pub struct UiamGatewayReleaseDto {
    /// 所属网关实例ID
    pub gateway_id: u64,
    /// 版本号
    /// 同一实例内从 1 递增
    pub version: i32,
    /// 渲染出的完整 TOML
    pub content: String,
    /// 内容摘要
    /// sha256 hex，用于「内容没变就不重复推」
    /// @len 64..=64
    pub checksum: String,
    /// 是否已推到 Consul
    #[db_default]
    pub pushed: bool,
    /// 推送成功时间戳
    pub pushed_ms: Option<u64>,
}
