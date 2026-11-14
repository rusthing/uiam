use robotech::macros::crud_dto;

/// # 网关负载均衡器
///
/// `balancers` 在 gatex 配置里是**实例级全局 map**（不分 listener），
/// 被 route 的 `to.type = "load-balancer"` 按名字引用。
///
/// ## `name` 为什么必须独立成列
///
/// 它是被引用的键。如果只存 `config_json`，发布前就没法在 SQL 层面校验
/// 「route 引用的名字是否存在」——只能把整棵子树读进内存再比对，且无法用
/// 唯一约束拦住重名。独立成列 + `(gateway_id, name)` 唯一，两件事一次解决。
///
/// ## `config_json`
///
/// 存 `BalancerConfig` 的 JSON 文本：算法、后端列表、健康检查。
/// 后端列表可能很长且结构随上游变化，拆列没有收益。
#[crud_dto]
pub struct UiamGatewayBalancerDto {
    /// 所属网关实例ID
    pub gateway_id: u64,
    /// 名称
    /// 被 route 的 to.type = load-balancer 引用
    /// @len 1..=100
    pub name: String,
    /// 配置（JSON 文本）
    /// 对应 BalancerConfig：算法、后端列表、健康检查
    pub config_json: String,
    /// 备注
    /// @len 0..=200
    pub remark: Option<String>,
    /// 启用
    /// 停用的不参与渲染
    #[db_default]
    pub enabled: bool,
}
