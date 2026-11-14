use robotech::macros::vo;

/// # 网关负载均衡器
#[vo]
pub struct UiamGatewayBalancerVo {
    /// ID
    pub id: u64,
    /// 所属网关实例ID
    pub gateway_id: u64,
    /// 名称
    pub name: String,
    /// 配置（JSON 文本）
    pub config_json: String,
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
