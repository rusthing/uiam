use robotech::macros::api_doc;

/// # 网关发布 OpenAPI 文档
///
/// 发布类动作单独一份文档：它们不是 CRUD，路径也不在 `/uiam/gateway` 的
/// 标准增删改查语义里。对应的路由树是 `UiamGatewayPublishRouter`。
///
/// 与 `UiamGatewayApiDoc` 一样，`#[api_doc]` **不会**自动枚举 handler，
/// 漏写就是文档里没有。新增发布类接口时，路由和这里两处都要加。
#[api_doc(render_preview_handler, publish_handler, rollback_handler)]
pub struct UiamGatewayPublishApiDoc;
