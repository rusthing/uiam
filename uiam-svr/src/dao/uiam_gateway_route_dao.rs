use robotech::macros::dao;

/// # 网关路由 DAO
///
/// ## 外键
/// - `listener_id` → `uiam_gateway_listener.id`：路由不能脱离监听器存在。
///   数据库侧是 `ON DELETE CASCADE`——删监听器时路由跟着走，否则会留下
///   一批指向不存在监听器的孤儿路由，发布时渲染出空 `routes` 数组。
///
/// ## 为什么不对 `(listener_id, sort_no)` 加唯一约束
///
/// 顺序确实是语义（前面的先匹配），但加唯一约束会让**调顺序**变成一场灾难：
/// 把 A 从 3 挪到 1，就得先把 B、C 临时挪到不可能的值，中间态必然撞唯一键。
/// 所以这里允许重复，渲染时按 `(sort_no, id)` 双键排序——重复的 `sort_no`
/// 有确定性的兜底，不会出现「刷新一次顺序就变一次」。
#[dao(
    foreign_keys: [
        ("listener_id", "uiam_gateway_listener", "网关监听器"),
    ],
)]
pub struct UiamGatewayRouteDao;
