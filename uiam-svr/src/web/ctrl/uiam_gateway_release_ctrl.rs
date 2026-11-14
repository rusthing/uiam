use robotech::macros::ctrl;

/// # 网关发布版本控制器
///
/// 路由前缀由 ctrl 名首段推导：`UiamGatewayReleaseCtrl` → `/uiam/gateway-release`。
///
/// 一期只暴露通用 CRUD 与检索（查历史版本）。真正的发布/回滚入口会在 svc 里
/// 落定后以自定义 handler 加进来——那时通用 `add` 就只剩补数据用途了。
#[ctrl]
struct UiamGatewayReleaseCtrl;
