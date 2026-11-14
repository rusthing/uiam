use robotech::macros::ctrl;

/// # 网关监听器控制器
///
/// 路由前缀由 ctrl 名首段推导：`UiamGatewayListenerCtrl` → `/uiam/gateway-listener`。
/// 按 `gateway_id` 查某个实例下的全部监听器，走检索接口（`gateway_id-0` + `gateway_id-op`）。
#[ctrl]
struct UiamGatewayListenerCtrl;
