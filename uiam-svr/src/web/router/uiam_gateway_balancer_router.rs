use robotech::macros::router;

/// # 网关负载均衡器路由
///
/// `crud` 展开成标准增删改查 + 检索路由，全部挂在 `/uiam/gateway-balancer` 下。
#[router(crud)]
struct UiamGatewayBalancerRouter;
