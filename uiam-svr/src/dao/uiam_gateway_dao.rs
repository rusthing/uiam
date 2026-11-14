use robotech::macros::dao;

/// # 网关实例 DAO
///
/// 一个实例对应 Consul KV 里的一个 key。`code` 与 `consul_key` 都要求唯一：
/// 前者是人的标识（与 Consul 注册名一致），后者决定发布时往哪个 key 写。
/// 两者重复都会让「发布到哪个实例」产生歧义，所以在写库阶段就拦住。
///
/// ## 唯一约束
/// - `code`：实例标识，如 `svr01`
/// - `consul_key`：一个 KV key 只能对应一个实例
#[dao(
    unique_keys: [
        ("code", "实例标识"),
        ("consul_key", "Consul KV key"),
    ],
)]
pub struct UiamGatewayDao;
