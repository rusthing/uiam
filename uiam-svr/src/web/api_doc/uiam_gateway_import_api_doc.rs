use robotech::macros::api_doc;

/// # 网关配置导入 OpenAPI 文档
///
/// 单独一份：导入不是 CRUD，也不属于「发布/回滚」那条链（它改的是库里的
/// 配置行，不碰 KV）。对应路由树 `UiamGatewayImportRouter`。
///
/// 与其它 `#[api_doc]` 一样，宏**不会**自动枚举 handler，漏写就是文档里没有。
#[api_doc(import_handler, source_handler)]
pub struct UiamGatewayImportApiDoc;
