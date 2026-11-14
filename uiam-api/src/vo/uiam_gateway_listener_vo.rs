use crate::dic::ListenerKind;
use robotech::macros::vo;

/// # 网关监听器
///
/// 路由不在这里内联，按 `listener_id` 单独查——一个监听器下几十条路由，
/// 内联会让「只改一条路由」也把整棵子树读出来。
#[vo]
pub struct UiamGatewayListenerVo {
    /// ID
    pub id: u64,
    /// 所属网关实例ID
    pub gateway_id: u64,
    /// 监听器类型
    pub kind: ListenerKind,
    /// 渲染顺序
    pub sort_no: i32,
    /// 监听地址（JSON 文本）
    pub addrs_json: String,
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
