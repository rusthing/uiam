use robotech::macros::ctrl;

/// # 网关负载均衡器控制器
///
/// 路由前缀由 ctrl 名首段推导：`UiamGatewayBalancerCtrl` → `/uiam/gateway-balancer`。
/// 按 `gateway_id` 查某个实例下的全部负载均衡器，走检索接口。
#[ctrl]
struct UiamGatewayBalancerCtrl;
