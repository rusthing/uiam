use robotech::macros::ctrl;

/// # 网关路由控制器
///
/// 路由前缀由 ctrl 名首段推导：`UiamGatewayRouteCtrl` → `/uiam/gateway-route`。
/// 按 `listener_id` 查某个监听器下的全部路由，走检索接口
/// （`listener_id-0` + `listener_id-op`），并带 `_orderBy=sort_no` 拿稳定顺序。
#[ctrl]
struct UiamGatewayRouteCtrl;
