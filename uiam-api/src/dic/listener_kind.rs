use robotech::macros::dic;
use strum::{AsRefStr, Display, EnumString};

/// # 监听器类型
///
/// gatex 的 `ListenerConfig` 与 `TcpListenerConfig` **结构同构**（都是
/// `addrs` + `routes`），差别只在渲染时落进 `listeners` 还是 `tcp-listeners`
/// 数组。所以库里合成一张表，用这一列区分，不建两张表。
///
/// 被 `UiamGatewayListenerVo` 用作字段，所以必须声明 `default`
/// （`#[vo]` 会生成 `i16 → 枚举` 的 `From<i16>`，越界需要兜底变体）。
#[dic(default = Http)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsRefStr, Display, EnumString)]
#[strum(serialize_all = "kebab-case")]
pub enum ListenerKind {
    /// HTTP / HTTPS 监听器，渲染到 `listeners`
    Http = 1,
    /// TCP 监听器，渲染到 `tcp-listeners`
    Tcp = 2,
}
