use robotech::macros::dao;

/// # 网关负载均衡器 DAO
///
/// ## 外键
/// - `gateway_id` → `uiam_gateway.id`：实例级资源，删除/更新受限
///
/// ## 唯一约束
/// - `(gateway_id, name)`：`balancers` 在 gatex 里是 map，同名会互相覆盖。
///   更关键的是 route 通过 `to.name` 引用它——重名会让「引用的是哪一个」
///   变成未定义行为，所以必须在写库阶段拦住，不能等渲染时才靠 map 的
///   后写覆盖来「决定」。
#[dao(
    foreign_keys: [
        ("gateway_id", "uiam_gateway", "网关实例"),
    ],
    unique_keys: [
        ("gateway_id,name", "实例内负载均衡器名称"),
    ],
)]
pub struct UiamGatewayBalancerDao;
