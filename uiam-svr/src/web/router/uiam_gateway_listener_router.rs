use robotech::macros::router;

/// # 网关监听器路由
///
/// `crud` 展开成标准增删改查 + 检索路由，全部挂在 `/uiam/gateway-listener` 下。
#[router(crud)]
struct UiamGatewayListenerRouter;
