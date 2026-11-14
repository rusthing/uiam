use robotech::api::U64;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// # 渲染预览
///
/// 点「发布」之前先看一眼：这份配置渲染出来长什么样、网关装不装得起来、
/// 推上去要不要重启。**只渲染不落库、不推 KV**，所以可以随便点。
///
/// ## 为什么把 `toml` 整段返回
///
/// 用户要核对的就是最终字节流。只返回结构化摘要等于让用户去猜「摘要对得上
/// 是不是就等于内容对得上」。这段文本会原样写进 `uiam_gateway_release.content`，
/// 预览看到的和发布出去的**逐字节相同**（`checksum` 是同一份文本算出来的）。
///
/// ## `structuralChange` 不是错误
///
/// `Some` 表示这次改动涉及监听地址、监听器增减、负载均衡器或 `pingora-conf`——
/// 这些只能在网关启动时生效。发布本身可以成功，但网关进程需要重启才会生效，
/// 必须让用户看见这句话再决定点不点。
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UiamGatewayRenderPreviewVo {
    /// 网关实例ID
    pub gateway_id: U64,
    /// 渲染出的完整 TOML
    pub toml: String,
    /// `sha256(toml)` 的十六进制串
    ///
    /// 与上一版相同说明内容没变，发布时可以跳过推送。
    pub checksum: String,
    /// HTTP 监听器数量
    pub http_listeners: u32,
    /// TCP 监听器数量
    pub tcp_listeners: u32,
    /// HTTP 路由条数（配置了几条，不是路由表项数）
    pub routes: u32,
    /// TCP 路由条数
    pub tcp_routes: u32,
    /// 实际解析到的负载均衡器数量（`Service` 匹配器会派生出带后缀的实例）
    pub balancers: u32,
    /// 结构性变更说明；`Some` 表示需要重启网关才能生效
    pub structural_change: Option<String>,
    /// 可发布但值得提醒的问题
    ///
    /// 包括：停用的记录被跳过、`extra_toml` 里被忽略的键、同监听器内的
    /// 路由遮蔽、定义了却没人引用的负载均衡器。
    pub warnings: Vec<String>,
}
