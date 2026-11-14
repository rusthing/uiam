use crate::dic::ListenerKind;
use robotech::macros::crud_dto;

/// # 网关监听器
///
/// HTTP 与 TCP 的 listener 在 gatex 里**结构同构**（都是 `addrs` + `routes`），
/// 差别只在渲染时落进 `listeners` 还是 `tcp-listeners` 数组，所以用 `kind` 区分，
/// 不建两张表。
///
/// ## `addrs_json` 为什么是字符串
///
/// 它存 `Vec<ListenerAddrConfig>` 的 JSON 文本，而那个类型在 `gatex-svr` 里。
/// `uiam-api` 是前后端共享的 crate，把 gatex 的类型引进来会污染依赖方向
/// （uiam-api → gatex-svr），所以这里收原始 JSON 文本，合法性由 svc 层校验。
#[crud_dto]
pub struct UiamGatewayListenerDto {
    /// 所属网关实例ID
    pub gateway_id: u64,
    /// 监听器类型
    /// 1=Http 渲染到 listeners；2=Tcp 渲染到 tcp-listeners
    pub kind: ListenerKind,
    /// 渲染顺序
    /// listeners 是数组，顺序即语义
    pub sort_no: i32,
    /// 监听地址（JSON 文本）
    /// Vec<ListenerAddrConfig>，含 addr 与可选 tls
    pub addrs_json: String,
    /// 备注
    /// @len 0..=200
    pub remark: Option<String>,
    /// 启用
    /// 停用的不参与渲染
    #[db_default]
    pub enabled: bool,
}
