use robotech::macros::router;

/// # 网关发布版本路由
///
/// `crud` 展开成标准增删改查 + 检索路由，全部挂在 `/uiam/gateway-release` 下。
#[router(crud)]
struct UiamGatewayReleaseRouter;
