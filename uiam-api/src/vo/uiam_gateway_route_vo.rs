use robotech::macros::vo;

/// # 网关路由
#[vo]
pub struct UiamGatewayRouteVo {
    /// ID
    pub id: u64,
    /// 所属监听器ID
    pub listener_id: u64,
    /// 匹配顺序
    pub sort_no: i32,
    /// 名称
    pub name: String,
    /// 匹配条件（JSON 文本）
    pub matcher_json: String,
    /// 转发目标（JSON 文本）
    pub to_json: String,
    /// 日志配置（JSON 文本）
    pub log_json: Option<String>,
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
