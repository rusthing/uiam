use crate::dto::*;
use crate::vo::{UiamGatewayRouteExVo, UiamGatewayRouteVo};
use robotech::macros::feign;
use robotech::micro_svc::FeignApiClient;

/// # 网关路由客户端
///
/// 方法由 `#[feign]` 按 `UiamGatewayRouteCtrl` 的路由规则生成，
/// 覆盖 CRUD 与 8 组检索接口。
#[feign]
pub struct UiamGatewayRouteApiClient {
    client: FeignApiClient,
}

impl UiamGatewayRouteApiClient {
    /// # 创建客户端
    ///
    /// ## 参数
    /// - `client`：已配置好服务名的 feign 客户端
    pub fn new(client: FeignApiClient) -> Self {
        Self { client }
    }
}
