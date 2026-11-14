use crate::api_client::uiam_gateway_api_client::UiamGatewayApiClient;
use crate::api_client::uiam_gateway_balancer_api_client::UiamGatewayBalancerApiClient;
use crate::api_client::uiam_gateway_listener_api_client::UiamGatewayListenerApiClient;
use crate::api_client::uiam_gateway_release_api_client::UiamGatewayReleaseApiClient;
use crate::api_client::uiam_gateway_route_api_client::UiamGatewayRouteApiClient;
use robotech::macros::api_client;

/// # uiam 客户端总入口
///
/// 调用方只需注入这一个结构，各实体的客户端从这里取。
/// 字段顺序按「实例 → 监听器 → 路由 → 负载均衡器 → 发布」的包含关系排列，
/// 与实际读库渲染时的遍历顺序一致。
#[api_client]
pub struct UiamApiClient {
    pub gateway: UiamGatewayApiClient,
    pub listener: UiamGatewayListenerApiClient,
    pub route: UiamGatewayRouteApiClient,
    pub balancer: UiamGatewayBalancerApiClient,
    pub release: UiamGatewayReleaseApiClient,
}
