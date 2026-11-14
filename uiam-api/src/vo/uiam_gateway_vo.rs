use robotech::macros::vo;

/// # 网关实例
///
/// 与 [`super::UiamGatewayDto`] 一一对应，额外带上审计字段。
///
/// 子资源（listener / route / balancer / release）不在 VO 里内联，走各自的接口按
/// `gateway_id` 查询——内联会让「只改一个路由」也把整棵子树读出来。
#[vo]
pub struct UiamGatewayVo {
    /// ID
    pub id: u64,
    /// 实例标识
    pub code: String,
    /// 展示名
    pub name: String,
    /// Consul KV 的完整 key
    pub consul_key: String,
    /// 高级配置（TOML 文本）
    pub extra_toml: Option<String>,
    /// 运维端点配置（JSON）
    pub ops_json: Option<String>,
    /// 静态资源配置（JSON）
    pub static_json: Option<String>,
    /// 上游异常配置（JSON）
    pub upstream_error_json: Option<String>,
    /// 备注
    pub remark: Option<String>,
    /// 启用
    pub enabled: bool,
    /// 创建者ID
    pub creater_id: u64,
    /// 创建时间戳
    pub create_ms: u64,
    /// 更新者ID
    pub updater_id: u64,
    /// 更新时间戳
    pub update_ms: u64,
}
