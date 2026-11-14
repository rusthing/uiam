use robotech::macros::ctrl;

/// # 网关实例控制器
///
/// 路由前缀由 ctrl 名首段推导：`UiamGatewayCtrl` → `/uiam/gateway`。
/// 一期的 CRUD 与 8 组检索接口全部由 `#[ctrl]` 生成，这里不放自定义 handler。
///
/// 发布类动作（渲染预览、发布、回滚）在 `uiam_gateway_publish_ctrl`，它们是
/// 独立的路由树与独立的 OpenAPI 文档，见 `UiamGatewayPublishApiDoc`。
#[ctrl]
struct UiamGatewayCtrl;
