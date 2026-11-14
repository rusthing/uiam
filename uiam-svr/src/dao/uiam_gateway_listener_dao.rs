use robotech::macros::dao;

/// # 网关监听器 DAO
///
/// 监听器是「端口 + 协议」的声明，HTTP 与 TCP 共用一张表（`kind` 区分），
/// 渲染时分别落进 `listeners` / `tcp-listeners`。
///
/// ## 外键
/// - `gateway_id` → `uiam_gateway.id`：监听器不能脱离实例存在，删除/更新受限
///
/// ## 为什么没有唯一约束
///
/// 两个监听器可以监听不同地址但同属一个实例（如 `0.0.0.0:80` 与 `0.0.0.0:443`），
/// 也可以配置成同一个地址（灰度期故意重叠）。唯一性真正的边界在**运行时**——
/// 端口冲突由 pingora 启动时报错，写库阶段拦不住也不该拦（换机器就未必冲突）。
/// `sort_no` 同样不要求唯一：它只是个排序提示，重复了按 id 兜底排序。
#[dao(
    foreign_keys: [
        ("gateway_id", "uiam_gateway", "网关实例"),
    ],
)]
pub struct UiamGatewayListenerDao;
