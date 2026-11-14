use robotech::macros::api_doc;

/// # 网关发布 OpenAPI 文档
///
/// 发布类动作单独一份文档：它们不是 CRUD，路径也不在 `/uiam/gateway` 的
/// 标准增删改查语义里。后续的「发布」「回滚」接口都加到这里。
///
/// 与 `UiamGatewayApiDoc` 一样，`#[api_doc]` **不会**自动枚举 handler，
/// 漏写就是文档里没有。
#[api_doc(render_preview_handler)]
pub struct UiamGatewayPublishApiDoc;
