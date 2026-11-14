use robotech::macros::vo;

/// # 网关发布版本
///
/// 带 `content`——发布详情页和 diff 都要看原始 TOML。代价是历史列表也会带上它，
/// 见 [`super::UiamGatewayReleaseDto`] 的说明。
#[vo]
pub struct UiamGatewayReleaseVo {
    /// ID
    pub id: u64,
    /// 所属网关实例ID
    pub gateway_id: u64,
    /// 版本号
    pub version: i32,
    /// 渲染出的完整 TOML
    pub content: String,
    /// 内容摘要
    pub checksum: String,
    /// 是否已推到 Consul
    pub pushed: bool,
    /// 推送成功时间戳
    pub pushed_ms: Option<u64>,
    /// 发布者ID
    pub creater_id: u64,
    /// 发布时间戳
    pub create_ms: u64,
    /// 最后操作者ID
    pub updater_id: u64,
    /// 最后操作时间戳
    pub update_ms: u64,
}
